import { EncryptionMetadata, EncryptedPackage } from '../types';

/**
 * 加密服务
 * 处理端到端加密、密钥派生和文件名加密
 */
export class CryptoService {
  private key: CryptoKey | null = null;
  private salt: Uint8Array | null = null;

  /** 加密算法 */
  private static readonly ALGORITHM = 'AES-GCM';
  /** 密钥长度（位） */
  private static readonly KEY_LENGTH = 256;
  /** PBKDF2 迭代次数 */
  private static readonly ITERATIONS = 200000;
  /** 盐值长度（字节） */
  private static readonly SALT_LENGTH = 32;
  /** IV 长度（字节） */
  private static readonly IV_LENGTH = 12;
  /** 文件名加密 IV 长度（字节） */
  private static readonly FILENAME_IV_LENGTH = 16;

  /**
   * 从密码派生加密密钥
   * 使用 PBKDF2-SHA256 派生密钥
   */
  async deriveKey(password: string, salt?: Uint8Array): Promise<CryptoKey> {
    console.log('[加密服务] 正在从密码派生密钥...');

    // 生成或使用提供的盐值
    this.salt = salt || crypto.getRandomValues(new Uint8Array(CryptoService.SALT_LENGTH));

    const encoder = new TextEncoder();

    // 导入密码作为密钥材料
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // 派生加密密钥
    this.key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: this.salt.buffer as ArrayBuffer,
        iterations: CryptoService.ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      {
        name: CryptoService.ALGORITHM,
        length: CryptoService.KEY_LENGTH,
      },
      false, // 不可导出
      ['encrypt', 'decrypt']
    );

    console.log('[加密服务] 密钥派生完成');
    return this.key;
  }

  /**
   * 使用已有密钥设置
   */
  setKey(key: CryptoKey, salt: Uint8Array): void {
    this.key = key;
    this.salt = salt;
  }

  /**
   * 获取当前盐值
   */
  getSalt(): Uint8Array | null {
    return this.salt;
  }

  /**
   * 检查密钥是否已派生
   */
  hasKey(): boolean {
    return this.key !== null;
  }

  /**
   * 加密数据
   * 返回包含元数据和加密数据的完整包
   */
  async encryptData(plaintext: Uint8Array): Promise<EncryptedPackage> {
    if (!this.key || !this.salt) {
      throw new Error('密钥未派生');
    }

    // 计算原始内容哈希
    const contentHash = await this.hash(plaintext);

    // 生成随机 IV
    const iv = crypto.getRandomValues(new Uint8Array(CryptoService.IV_LENGTH));

    // 加密
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: CryptoService.ALGORITHM,
        iv: iv.buffer as ArrayBuffer,
      },
      this.key,
      plaintext.buffer as ArrayBuffer
    );

    // 构建元数据
    const meta: EncryptionMetadata = {
      algorithm: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA256',
      iterations: CryptoService.ITERATIONS,
      salt: this.base64Encode(this.salt),
      iv: this.base64Encode(iv),
      contentHash: contentHash,
      timestamp: Date.now(),
    };

    return {
      meta,
      data: this.base64Encode(new Uint8Array(ciphertext)),
    };
  }

  /**
   * 解密数据
   */
  async decryptData(package_: EncryptedPackage): Promise<Uint8Array> {
    if (!this.key) {
      throw new Error('密钥未派生');
    }

    // 解码 IV 和密文
    const iv = this.base64Decode(package_.meta.iv);
    const ciphertext = this.base64Decode(package_.data);

    // 解密
    const plaintext = await crypto.subtle.decrypt(
      {
        name: CryptoService.ALGORITHM,
        iv: iv.buffer as ArrayBuffer,
      },
      this.key,
      ciphertext.buffer as ArrayBuffer
    );

    const result = new Uint8Array(plaintext);

    // 验证内容哈希
    const computedHash = await this.hash(result);
    if (computedHash !== package_.meta.contentHash) {
      throw new Error('内容哈希校验失败，数据可能已损坏');
    }

    return result;
  }

  /**
   * 加密文件路径
   * 返回加密后的路径（用于远端存储）
   */
  async encryptPath(path: string): Promise<string> {
    if (!this.key) {
      throw new Error('密钥未派生');
    }

    // 分段加密路径
    const parts = path.split('/');
    const encryptedParts: string[] = [];

    for (const part of parts) {
      if (part === '') continue;

      const encoder = new TextEncoder();
      const data = encoder.encode(part);

      // 使用不同的 IV 长度用于文件名
      const iv = crypto.getRandomValues(new Uint8Array(CryptoService.FILENAME_IV_LENGTH));

      const ciphertext = await crypto.subtle.encrypt(
        {
          name: CryptoService.ALGORITHM,
          iv: iv.buffer as ArrayBuffer,
        },
        this.key,
        data.buffer as ArrayBuffer
      );

      // 组合 IV + 密文，然后 Base64 编码
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), iv.length);

      // URL 安全的 Base64 编码
      encryptedParts.push(this.base64UrlEncode(combined));
    }

    return encryptedParts.join('/');
  }

  /**
   * 解密文件路径
   */
  async decryptPath(encryptedPath: string): Promise<string> {
    if (!this.key) {
      throw new Error('密钥未派生');
    }

    const parts = encryptedPath.split('/');
    const decryptedParts: string[] = [];

    for (const part of parts) {
      if (part === '') continue;

      try {
        // URL 安全的 Base64 解码
        const combined = this.base64UrlDecode(part);

        // 分离 IV 和密文
        const iv = combined.slice(0, CryptoService.FILENAME_IV_LENGTH);
        const ciphertext = combined.slice(CryptoService.FILENAME_IV_LENGTH);

        // 解密
        const plaintext = await crypto.subtle.decrypt(
          {
            name: CryptoService.ALGORITHM,
            iv: iv.buffer as ArrayBuffer,
          },
          this.key,
          ciphertext.buffer as ArrayBuffer
        );

        const decoder = new TextDecoder();
        decryptedParts.push(decoder.decode(plaintext));
      } catch (error) {
        console.warn('[加密服务] 路径解密失败，可能未加密：', part);
        decryptedParts.push(part);
      }
    }

    return decryptedParts.join('/');
  }

  /**
   * 计算 SHA-256 哈希
   */
  async hash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    return this.base64Encode(hashArray);
  }

  /**
   * 生成随机 ID
   */
  generateId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return this.base64UrlEncode(bytes);
  }

  /**
   * 生成设备 ID
   */
  generateDeviceId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return `dev_${this.base64UrlEncode(bytes)}`;
  }

  /**
   * 生成仓库 ID
   */
  generateRepoId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `repo_${this.base64UrlEncode(bytes)}`;
  }

  /**
   * Base64 编码
   */
  private base64Encode(data: Uint8Array): string {
    const binary = String.fromCharCode(...data);
    return btoa(binary);
  }

  /**
   * Base64 解码
   */
  private base64Decode(str: string): Uint8Array {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * URL 安全的 Base64 编码
   */
  private base64UrlEncode(data: Uint8Array): string {
    const base64 = this.base64Encode(data);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * URL 安全的 Base64 解码
   */
  private base64UrlDecode(str: string): Uint8Array {
    // 还原标准 Base64
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // 补齐填充
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    return this.base64Decode(base64);
  }

  /**
   * 导出密钥信息（用于持久化会话）
   * 注意：这只是导出派生参数，不是密钥本身
   */
  exportKeyInfo(): { salt: string; iterations: number } | null {
    if (!this.salt) return null;
    return {
      salt: this.base64Encode(this.salt),
      iterations: CryptoService.ITERATIONS,
    };
  }

  /**
   * 清除密钥
   */
  clearKey(): void {
    this.key = null;
    this.salt = null;
    console.log('[加密服务] 密钥已清除');
  }
}

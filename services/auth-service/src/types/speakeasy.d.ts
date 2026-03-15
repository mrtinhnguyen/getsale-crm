declare module 'speakeasy' {
  export interface GeneratedSecret {
    ascii: string;
    hex: string;
    base32: string;
    otpauth_url?: string;
  }

  export function generateSecret(options?: {
    length?: number;
    name?: string;
    issuer?: string;
  }): GeneratedSecret;

  export const totp: {
    verify(options: {
      secret: string;
      encoding?: 'ascii' | 'hex' | 'base32';
      token: string;
      window?: number;
    }): boolean;
  };
}

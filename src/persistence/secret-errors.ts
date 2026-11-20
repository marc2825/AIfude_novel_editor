/** A plain snapshot must never overwrite a secret shell, or the other way round, except through convertSecrecy. */
export class SecretStateError extends Error {
  constructor() { super("シークレット作品の保存形式が一致しません。"); this.name = "SecretStateError"; }
}
/** The data key is needed but the vault is locked. */
export class SecretLockedError extends Error {
  constructor(readonly projectId: string | null = null) { super("シークレット作品はロック中です。パスワードを入力して解錠してください。"); this.name = "SecretLockedError"; }
}

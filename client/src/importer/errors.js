/** An error the person can be told about in plain words. `code` says what kind, for the screen that handles it. */
export class ImportError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export class ScoringError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'ScoringError';
    this.code = code;
    this.details = details;
  }
}

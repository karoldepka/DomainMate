export class PaymentError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) { super(message); this.status = status }
}

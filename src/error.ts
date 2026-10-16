/** Error raised when an accsyn API call fails. */
export class AccsynError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccsynError";
  }
}

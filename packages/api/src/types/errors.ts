export class KycError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'KycError';
  }
}

export class NotFoundError extends KycError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
  }
}

export class UnauthorizedError extends KycError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends KycError {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class ValidationError extends KycError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 422);
  }
}

export class SessionExpiredError extends KycError {
  constructor() {
    super('Session has expired', 'SESSION_EXPIRED', 410);
  }
}

export class InvalidStateError extends KycError {
  constructor(current: string, attempted: string) {
    super(
      `Cannot perform "${attempted}" in state "${current}"`,
      'INVALID_STATE',
      409,
    );
  }
}

export class FileValidationError extends KycError {
  constructor(message: string) {
    super(message, 'FILE_VALIDATION_ERROR', 422);
  }
}

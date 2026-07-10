export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function success(body: unknown, statusCode = 200): ApiResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function notFound(message = "Not found"): ApiResponse {
  return {
    statusCode: 404,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: message }),
  };
}

export function badRequest(message: string): ApiResponse {
  return {
    statusCode: 400,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: message }),
  };
}

export function serverError(message = "Internal server error"): ApiResponse {
  return {
    statusCode: 500,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: message }),
  };
}

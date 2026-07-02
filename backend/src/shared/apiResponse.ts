export type ApiMeta = Record<string, unknown>;

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta?: ApiMeta;
};

export type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
  };
  status: number;
};

export function apiSuccess<T>(data: T, meta?: ApiMeta): ApiSuccessResponse<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function apiError(code: string, message: string, status = 500): ApiErrorResponse {
  return {
    success: false,
    error: { code, message },
    status,
  };
}

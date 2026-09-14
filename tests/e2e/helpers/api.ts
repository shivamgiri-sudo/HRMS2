import { APIRequestContext } from '@playwright/test';

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5055';

export class ApiHelper {
  private request: APIRequestContext;
  private token: string;

  constructor(request: APIRequestContext, token: string) {
    this.request = request;
    this.token = token;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async get(path: string) {
    const res = await this.request.get(`${BACKEND_URL}${path}`, { headers: this.headers() });
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), body, ok: res.ok() };
  }

  async post(path: string, data?: any) {
    const res = await this.request.post(`${BACKEND_URL}${path}`, {
      headers: this.headers(),
      data: data ?? {},
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), body, ok: res.ok() };
  }

  async patch(path: string, data?: any) {
    const res = await this.request.patch(`${BACKEND_URL}${path}`, {
      headers: this.headers(),
      data: data ?? {},
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), body, ok: res.ok() };
  }

  async put(path: string, data?: any) {
    const res = await this.request.put(`${BACKEND_URL}${path}`, {
      headers: this.headers(),
      data: data ?? {},
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), body, ok: res.ok() };
  }

  async delete(path: string) {
    const res = await this.request.delete(`${BACKEND_URL}${path}`, { headers: this.headers() });
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), body, ok: res.ok() };
  }

  async uploadFile(path: string, fieldName: string, filePath: string, extraFields?: Record<string, string>) {
    const multipart: Record<string, any> = {};
    multipart[fieldName] = filePath;
    if (extraFields) {
      Object.assign(multipart, extraFields);
    }
    const res = await this.request.post(`${BACKEND_URL}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      multipart,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), body, ok: res.ok() };
  }
}

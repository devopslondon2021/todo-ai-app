const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

type FetchOptions = {
  method?: string;
  body?: unknown;
  params?: Record<string, string | undefined>;
  signal?: AbortSignal;
};

export async function api<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { method = "GET", body, params, signal } = options;

  let url = `${BASE_URL}/api${endpoint}`;
  if (params) {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") sp.set(key, value);
    }
    const qs = sp.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `API error: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

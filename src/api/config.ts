// Base URL for the Node backend (Express + Socket.IO). Empty string means
// same-origin — the default for local dev (Vite proxy) and single-host setups.
// On Vercel the frontend is static, so point this at the backend's public URL
// (Railway/Render/Fly) via a VITE_API_URL build-time env var.
export const API_BASE_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

// Build an absolute API URL when API_BASE_URL is set, otherwise keep the
// same-origin relative path so the dev proxy keeps working untouched.
export function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

import axios from 'axios';
import { getApiBaseUrl } from '@/lib/api/public-api-base';

const base = getApiBaseUrl();

export const authApi = axios.create({
  baseURL: base ? `${base}/api/auth` : '/api/auth',
  withCredentials: true,
});

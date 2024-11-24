import axios, { AxiosInstance } from 'axios';
import { AdminCreateAxiosService, CreateAxiosService } from './axiosService';

/** @description 기본 API */

interface BasicAxiosInstance {
  getInstance: () => AxiosInstance;
}

const basicAxiosInstance = (): BasicAxiosInstance => {
  const service = new CreateAxiosService(
    axios.create({
      baseURL: '',
    })
  );

  service.initBasicResponseInterceptor();

  return {
    getInstance: service.getInstance,
  };
};

/** @description 토큰 필요 API */

interface AuthAxiosInstance {
  getInstance: () => AxiosInstance;
  setAuthRequestInterceptor: (accessToken: string) => void;
  removeAuthRequestInterceptor: () => void;
}

const authAxiosInstance = (): AuthAxiosInstance => {
  const service = new CreateAxiosService(
    axios.create({
      baseURL: '',
    })
  );

  service.initAuthResponseInterceptor();

  return {
    getInstance: service.getInstance,
    setAuthRequestInterceptor: service.setAuthRequestInterceptor,
    removeAuthRequestInterceptor: service.removeAuthRequestInterceptor,
  };
};

const authAxios = authAxiosInstance();
const basicAxios = basicAxiosInstance();

export const apiServices = {
  basicAxios,
  authAxios,
};

/** @description 어드민 백오피스 API */

const adminAxiosInstance = () => {
  const service = new AdminCreateAxiosService(
    axios.create({
      baseURL: '',
      withCredentials: true,
    })
  );

  service.initAdminRequestInterceptor();
  service.initAdminResponseInterceptor();

  return {
    get: service.GET,
    post: service.POST,
    put: service.PUT,
    delete: service.DELETE,
  };
};

const adminAxios = adminAxiosInstance();

export const apiAdminServices = {
  adminAxios,
};

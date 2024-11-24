import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { apiUtils } from './utils';
import { apiConstants } from './constants';

class BaseAxiosService {
  protected readonly DEFAULT_RETRY_COUNT: number = 3; // 기본 재시도 횟수
  protected readonly DEFAULT_RETRY_DELAY: number = 10 * 1000; // 기본 재시도 간격(ms)

  protected statusCode = {
    SERVER_ERROR: 500,
    UN_AUTHORIZED: 401,
  };

  constructor(protected axiosInstance: AxiosInstance) {}

  protected generateSuccessMessage = (successMessage: string) => {
    apiUtils.executeDispatchEvent('success', successMessage);
  };

  protected generateErrorMessage = (errorMessage: string) => {
    apiUtils.executeDispatchEvent('error', errorMessage);
  };

  protected promiseReject = (error: AxiosError): Promise<AxiosError> => Promise.reject(error);

  protected consoleError = (error: AxiosError) => {
    const { config } = error;
    if (config) {
      if (process.env.NODE_ENV === 'production') {
        console.error('Request failed:', error.message);
        return;
      }
      const method = config.method?.toLocaleUpperCase();
      const url = config.url;
      console.error(`🛑 ${method} => ${url}`, error);
    } else {
      console.error(error);
    }
  };

  /** 재시도 처리 */
  protected retryRequest = (
    response: AxiosError | AxiosResponse | undefined,
    retryCount = this.DEFAULT_RETRY_COUNT
  ) => {
    return new Promise((resolve, reject) => {
      if (retryCount <= 0) {
        retryCount = 3;
        reject(new Error('Maximum Retry'));
        return;
      }
      setTimeout(() => {
        if (!response || !response.config) {
          reject(new Error('No response config'));
          return; // response.config 타입가드
        }
        resolve(this.axiosInstance.request(response.config).catch(() => this.retryRequest(response, retryCount - 1)));
      }, this.DEFAULT_RETRY_DELAY);
    });
  };

  /** 응답 성공 시 */
  protected onFulfilled = (response: AxiosResponse) => {
    return response;
  };

  private isUndefined = (value: unknown): value is undefined => {
    return value === undefined;
  };

  protected isErrorFromServer = (statusCode: number | undefined) => {
    if (this.isUndefined(statusCode)) {
      return true;
    }
    return statusCode >= this.statusCode.SERVER_ERROR;
  };

  protected isErrorFromRequest = (error: AxiosError): boolean => {
    return !error.config || !error.response || !error.response.status;
  };

  protected isUnexpectedError = (statusCode: number | undefined) => {
    if (this.isUndefined(statusCode)) {
      return true;
    }
    return statusCode < this.statusCode.SERVER_ERROR && statusCode !== this.statusCode.UN_AUTHORIZED;
  };

  getInstance = () => {
    return this.axiosInstance;
  };
}

/**
 * ---------------------- 서비스용 -----------------------------
 */

interface ApiRequestMicrotaskQueueItem {
  resolve: (value?: unknown) => void;
  reject: (error?: unknown) => void;
  config: InternalAxiosRequestConfig;
}

export class CreateAxiosService extends BaseAxiosService {
  private apiRequestMicrotaskQueueItem: ApiRequestMicrotaskQueueItem[] = [];
  private authRequestInterceptorId: number | null = null;
  private isApiRequestAuthLocked: boolean = false;

  constructor(instance: AxiosInstance) {
    super(instance);
  }

  private formatAuthorizationHeader = (accessToken: string) => {
    return `Bearer ${accessToken}`;
  };

  private setTokenInCookie = (accessToken: string, refreshToken: string) => {
    // ! 쿠키에 accessToken과 refreshToken을 저장합니다.
    // setCookie(variableStore.TOKEN_KEY.ACCESS_TOKEN, accessToken);
    // setCookie(variableStore.TOKEN_KEY.REFRESH_TOKEN, refreshToken);
  };

  private removeTokenFromCookie = () => {
    // ! 쿠키에서 accessToken과 refreshToken을 삭제합니다.
    // removeCookie(variableStore.TOKEN_KEY.ACCESS_TOKEN);
    // removeCookie(variableStore.TOKEN_KEY.REFRESH_TOKEN);
  };

  private onAuthReject = async (error: AxiosError) => {
    const { response, config, status } = error;

    this.consoleError(error);

    if (this.isErrorFromRequest(error)) {
      return this.promiseReject(error);
    }

    if (this.isErrorFromServer(status)) {
      return this.retryRequest(response);
    }

    if (this.isUnexpectedError(status)) {
      return this.promiseReject(error);
    }

    if (config && status === this.statusCode.UN_AUTHORIZED) {
      try {
        if (this.isApiRequestAuthLocked) {
          return new Promise((resolve, reject) => {
            this.apiRequestMicrotaskQueueItem.push({ config, resolve, reject });
          });
        }

        if (!this.isApiRequestAuthLocked) {
          this.isApiRequestAuthLocked = true;

          // ! 쿠키에서 refreshToken을 가져옵니다.
          // getCookie(variableStore.TOKEN_KEY.REFRESH_TOKEN)
          const refreshTokenCookie = 'REFRESH_TOKEN';

          if (refreshTokenCookie) {
            const tokenReissueResponse = await axios<{
              accessToken: string;
              refreshToken: string;
            }>({
              method: 'POST',
              url: ``,
              headers: {
                Authorization: refreshTokenCookie,
              },
            });
            const data = tokenReissueResponse.data;
            if (data) {
              const { accessToken, refreshToken } = data;
              config.headers.Authorization = this.formatAuthorizationHeader(accessToken);
              this.setTokenInCookie(accessToken, refreshToken);

              this.apiRequestMicrotaskQueueItem.forEach(({ config, resolve, reject }) => {
                this.axiosInstance.request(config).then(resolve).catch(reject);
              });

              this.apiRequestMicrotaskQueueItem = [];
              this.setAuthRequestInterceptor(accessToken);
              return this.axiosInstance.request(config);
            }
          } else {
            throw new Error('Token Reissue Error');
          }
        }
      } catch (error) {
        console.error(error);
        this.removeTokenFromCookie();
        window.location.reload();
      } finally {
        this.isApiRequestAuthLocked = false;
      }
    }
  };

  private onRejected = (error: AxiosError) => {
    const { response, status } = error;

    if (this.isErrorFromServer(status)) {
      return this.retryRequest(response);
    }

    return Promise.reject(error);
  };

  /** @description 인증 관련 요청 인터셉터 */
  setAuthRequestInterceptor = (accessToken: string) => {
    if (this.authRequestInterceptorId !== null) {
      this.axiosInstance.interceptors.request.clear();
    }
    this.authRequestInterceptorId = this.axiosInstance.interceptors.request.use(
      (config) => {
        if (config.headers) {
          config.headers.Authorization = this.formatAuthorizationHeader(accessToken);
        }
        return config;
      },
      (error: AxiosError) => this.promiseReject(error)
    );
  };

  /** @description 인증 관련 요청 인터셉터 삭제 */
  removeAuthRequestInterceptor = () => {
    if (this.authRequestInterceptorId === null) {
      return;
    }
    this.axiosInstance.interceptors.request.eject(this.authRequestInterceptorId);
    this.authRequestInterceptorId = null;
    this.removeTokenFromCookie();
  };

  /** @description 기본 응답 인터셉터 */
  initBasicResponseInterceptor = () => {
    this.axiosInstance.interceptors.response.use(this.onFulfilled, this.onRejected);
  };

  /** @description 인증 관련 응답 인터셉터 */
  initAuthResponseInterceptor = () => {
    this.axiosInstance.interceptors.response.use(this.onFulfilled, this.onAuthReject);
  };
}

/**
 * ---------------------- 어드민 백오피스용 -----------------------------
 */

type AxiosUrl = AxiosRequestConfig['url'];
type AxiosData = AxiosRequestConfig['data'];
type AxiosHeaders = AxiosRequestConfig['headers'];
type AxiosParams = AxiosRequestConfig['params'];
type AxiosWithCredentials = AxiosRequestConfig['withCredentials'];

type AxiosOption = {
  successMessage?: string;
  errorMessage?: string;
  headers?: AxiosHeaders;
  params?: AxiosParams;
  data?: AxiosData;
  withCredentials?: AxiosWithCredentials;
};

type MessageOption = Pick<AxiosOption, 'successMessage' | 'errorMessage'>;

class AdminStore extends BaseAxiosService {
  protected path = {
    SIGNIN: '/signin',
  };
  protected isRedirectingBy401Unauthorized: boolean = false;
  protected redirectTimeout: NodeJS.Timeout | null = null;
  protected redirectTime: number = 5000;
  protected messageOption: MessageOption = {};

  constructor(axiosInstance: AxiosInstance) {
    super(axiosInstance);
    this.isRedirectingBy401Unauthorized = Boolean(sessionStorage.getItem(apiConstants.UNAUTHORIZED));
  }

  protected executeUnAuthorized = () => {
    sessionStorage.setItem(apiConstants.UNAUTHORIZED, 'true');
  };

  protected resetUnAuthorizedState = () => {
    sessionStorage.removeItem(apiConstants.UNAUTHORIZED);
  };

  setMessageOption = (messageOption: MessageOption = {}) => {
    this.messageOption = messageOption;
  };
}

export class AdminCreateAxiosService extends AdminStore {
  headers?: AxiosHeaders;
  params?: AxiosParams;
  data?: AxiosData;
  withCredentials?: AxiosWithCredentials;

  constructor(axiosInstance: AxiosInstance) {
    super(axiosInstance);
  }

  private verifySigninConfig = (config: InternalAxiosRequestConfig) => {
    /* 401 이후, 로그인 요청시에만 API 콜 허용 */
    return config.url === this.path.SIGNIN;
  };

  initAdminRequestInterceptor = () => {
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.isRedirectingBy401Unauthorized) {
          if (this.verifySigninConfig(config)) {
            return config;
          }
          return Promise.reject('Redirecting by 401 Unauthorized');
        }
        return config;
      },
      (error) => {
        this.generateErrorMessage('Request Error');
        return this.promiseReject(error);
      }
    );
  };

  initAdminResponseInterceptor = () => {
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        this.isRedirectingBy401Unauthorized = false;
        this.resetUnAuthorizedState();
        const initSuccessMessage = this.messageOption.successMessage;
        if (initSuccessMessage) {
          this.generateSuccessMessage(initSuccessMessage);
        }
        return response;
      },
      (error: AxiosError) => {
        const statusCode = error.response?.status;

        if (!statusCode) {
          return this.promiseReject(error);
        }

        if (!this.isRedirectingBy401Unauthorized) {
          this.consoleError(error);
        }

        const initErrorMessage = this.messageOption.errorMessage;
        if (initErrorMessage) {
          this.generateErrorMessage(initErrorMessage);
        }

        if (this.isErrorFromRequest(error)) {
          this.generateErrorMessage('Request Error');
          return this.promiseReject(error);
        }

        if (this.isErrorFromServer(statusCode)) {
          this.generateErrorMessage('Internal Server Error');
          return this.promiseReject(error);
        }

        if (this.isUnexpectedError(statusCode)) {
          this.generateErrorMessage(error.message);
          return this.promiseReject(error);
        }

        const isSigninPage = () => window.location.pathname === this.path.SIGNIN;

        if (isSigninPage()) {
          this.executeUnAuthorized();
          return this.promiseReject(error);
        }

        /**
         * 이용중 중 401 Unauthorized 에러
         */
        if (!this.isRedirectingBy401Unauthorized) {
          if (this.redirectTimeout) {
            clearTimeout(this.redirectTimeout);
          }

          this.executeUnAuthorized();
          this.isRedirectingBy401Unauthorized = true;

          const seconds = this.redirectTime / 1000;
          this.generateErrorMessage(
            `인증이 만료되었습니다. 다시 로그인해 주세요.\n${seconds}초 후 로그인 페이지로 자동 이동합니다.`
          );
          this.redirectTimeout = setTimeout(() => {
            if (isSigninPage()) {
              if (this.redirectTimeout) {
                clearTimeout(this.redirectTimeout);
              }
              return;
            }
            window.location.href = this.path.SIGNIN;
          }, this.redirectTime);
        }
        return Promise.reject(error);
      }
    );
  };

  private request = <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: AxiosUrl, option: AxiosOption = {}) => {
    const instance = this.getInstance();
    const { successMessage, errorMessage, ...axiosOption } = option;
    this.setMessageOption({ successMessage, errorMessage });
    return instance<T>({
      method,
      url,
      ...axiosOption,
    });
  };

  GET = <T>(url: AxiosUrl, option: AxiosOption = {}) => {
    return this.request<T>('GET', url, option);
  };

  POST = <T>(url: AxiosUrl, option: AxiosOption = {}) => {
    return this.request<T>('POST', url, option);
  };

  PUT = <T>(url: AxiosUrl, option: AxiosOption = {}) => {
    return this.request<T>('PUT', url, option);
  };

  DELETE = <T>(url: AxiosUrl, option: AxiosOption = {}) => {
    return this.request<T>('DELETE', url, option);
  };
}

import { apiConstants } from './constants';

export interface CustomEventDetail {
  type: 'success' | 'error'; // 추가 custom event type
  message: string;
}

const executeDispatchEvent = (type: CustomEventDetail['type'], message: string) => {
  window.dispatchEvent(
    new CustomEvent<CustomEventDetail>(apiConstants.DISPATCH_TOAST, {
      detail: {
        type,
        message,
      },
    })
  );
};

export const apiUtils = {
  executeDispatchEvent,
};

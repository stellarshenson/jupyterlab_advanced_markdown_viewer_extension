import { URLExt } from '@jupyterlab/coreutils';

import { ServerConnection } from '@jupyterlab/services';

/**
 * What the server extension answered: the response and its body, parsed
 * where it was JSON and left as text where it was not.
 */
export interface IAnswer {
  response: Response;
  data: any;
}

/**
 * Call the server extension and answer with whatever it said.
 *
 * The status is left to the caller: the write route says what it did through
 * a 409 and tells an absent server extension, whose 404 carries the server's
 * HTML page, from a served 404, whose body is JSON.
 *
 * @param endPoint API REST end point for the extension
 * @param serverSettings The server settings to use for the request
 * @param init Initial values for the request
 */
export async function fetchAPI(
  endPoint: string,
  serverSettings: ServerConnection.ISettings,
  init: RequestInit = {}
): Promise<IAnswer> {
  // Make request to Jupyter API
  const requestUrl = URLExt.join(
    serverSettings.baseUrl,
    'jupyterlab-advanced-markdown-viewer-extension', // our server extension's API namespace
    endPoint
  );

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(
      requestUrl,
      init,
      serverSettings
    );
  } catch (error) {
    throw new ServerConnection.NetworkError(error as any);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch {
      console.log('Not a JSON response body.', response);
    }
  }

  return { response, data };
}

/**
 * Call the server extension
 *
 * @param endPoint API REST end point for the extension
 * @param serverSettings The server settings to use for the request
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
export async function requestAPI<T>(
  endPoint: string,
  serverSettings: ServerConnection.ISettings,
  init: RequestInit = {}
): Promise<T> {
  const { response, data } = await fetchAPI(endPoint, serverSettings, init);

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}

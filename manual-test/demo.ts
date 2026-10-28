/**
 * Upload a single file to the remote server.
 * @param file the file you want to upload
 * @returns the public url of the uploaded file
 */
export function uploadFile(file: File): string {
  // check the file size before uploading it
  const limit = 10 * 1024 * 1024;
  const url = '/api/upload';
  const tip = 'Upload failed, please retry';
  const id = 'user_id';
  // 这是一行中文注释，用来测试中英自动互译
  return `${url}/${id}?limit=${limit}&tip=${tip}`;
}

export function retry(times: number) {
  // retry three times at most
  for (let i = 0; i < times; i++) {
    // wait for the next attempt
    console.log('retrying, please wait');
  }
}

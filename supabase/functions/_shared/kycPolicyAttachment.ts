const attachmentFilename = "PayByCard_-_Accepted_Term_&_Conditions.pdf";
let attachmentBase64Promise: Promise<string> | null = null;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

export function getKycPolicyAttachment(): Promise<{
  attachment_base64: string;
  attachment_filename: string;
  attachment_content_type: string;
}> {
  if (!attachmentBase64Promise) {
    attachmentBase64Promise = Deno.readFile(
      new URL("./paybycard-accepted-terms.pdf", import.meta.url),
    ).then(encodeBase64);
  }

  return attachmentBase64Promise.then((attachment_base64) => ({
    attachment_base64,
    attachment_filename: attachmentFilename,
    attachment_content_type: "application/pdf",
  }));
}

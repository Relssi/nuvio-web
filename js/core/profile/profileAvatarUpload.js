// Lets a profile use a photo from the user's device. The image is cropped to
// a square, scaled down to AVATAR_SIZE px and stored as a small JPEG data URL
// in the profile's avatarUrl, so it works without the online avatar catalog.

const AVATAR_SIZE = 256;
const JPEG_QUALITY = 0.85;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Não foi possível ler essa imagem."));
    };
    image.src = objectUrl;
  });
}

export async function resizeAvatarFile(file) {
  if (!file || !/^image\//i.test(String(file.type || ""))) {
    throw new Error("Escolha um arquivo de imagem.");
  }
  if (Number(file.size || 0) > MAX_INPUT_BYTES) {
    throw new Error("Imagem muito grande (máximo 20 MB).");
  }
  const image = await loadImage(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (!side) {
    throw new Error("Não foi possível ler essa imagem.");
  }
  const sourceX = Math.floor((image.naturalWidth - side) / 2);
  const sourceY = Math.floor((image.naturalHeight - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

// Must be called synchronously from a click/key handler so the browser
// allows the file chooser to open. Resolves to a data URL, or null when the
// user cancels.
export function pickAvatarImage() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      input.remove();
      callback();
    };
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        finish(() => resolve(null));
        return;
      }
      resizeAvatarFile(file).then(
        (dataUrl) => finish(() => resolve(dataUrl)),
        (error) => finish(() => reject(error))
      );
    });
    input.addEventListener("cancel", () => finish(() => resolve(null)));
    input.click();
  });
}

export function isUploadedAvatarUrl(value) {
  return /^data:image\//i.test(String(value || ""));
}

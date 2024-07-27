export const WS_URL = "http://localhost:5000";

export const Sleep = (time) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve("");
    }, time);
  });
};


export const regexpFloatingPointNumber = /^[0-9\d, ]*(\.|\/)?[0-9\d,]*$/;

export const regexpLettersAndNumbers = /^[a-zA-Z0-9]*$/;

export const regexpPasswordSpec = /^(?=.*[a-z])(?=.*[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~])(?=.*[A-Z])[0-9a-zA-Z!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]{8,}$/;

export const UrlValidation = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/

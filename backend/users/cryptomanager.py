from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from Crypto.Random import get_random_bytes
import binascii


class CryptoManager:

    def __init__(self, encryption_key: str = None):
        """
        Initializes the CryptoManager with an encryption key.
        If no key is provided, it uses the default key.
        """
        self.encryption_key = bytes.fromhex(encryption_key)

    def encrypt_data(self, message: str) -> str:
        """
        Encrypts a message using AES-256-CBC.
        The IV is randomly generated and prepended to the encrypted output.
        :param message: The plaintext message to encrypt.
        :return: A hexadecimal string containing IV + encrypted data.
        """
        iv = get_random_bytes(16)
        cipher = AES.new(self.encryption_key, AES.MODE_CBC, iv)

        encrypted = cipher.encrypt(pad(message.encode(), AES.block_size))

        return binascii.hexlify(iv + encrypted).decode()

    def decrypt_data(self, encrypted_string: str) -> str:
        """
        Decrypts an AES-256-CBC encrypted message.
        Extracts the IV from the stored data and decrypts the message.
        :param encrypted_string: The encrypted hexadecimal string containing IV + data.
        :return: The decrypted plaintext message.
        """
        encrypted_bytes = binascii.unhexlify(encrypted_string)
        iv = encrypted_bytes[:16]
        encrypted_data = encrypted_bytes[16:]

        cipher = AES.new(self.encryption_key, AES.MODE_CBC, iv)
        decrypted = unpad(cipher.decrypt(encrypted_data), AES.block_size)

        return decrypted.decode()

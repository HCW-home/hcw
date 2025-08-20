
from django.db import models


class EncryptedField(models.TextField):
    def __init__(self, *args, **kwargs):
        # Le champ lié à l'utilisateur
        self.user_field = kwargs.pop("user_field", "user")
        super().__init__(*args, **kwargs)

    def encrypt(self, value, public_key_pem):
        """
        Chiffre une valeur avec la clé publique de l'utilisateur.
        """
        public_key = serialization.load_pem_public_key(public_key_pem.encode())

        encrypted = public_key.encrypt(
            value.encode(),
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )
        return base64.b64encode(encrypted).decode()

    def get_prep_value(self, value):
        """
        Avant de stocker la donnée dans la base de données, elle est chiffrée.
        """
        if value is None:
            return value

        instance = self.model.objects.get(
            pk=self.instance.pk) if self.instance else None
        user = getattr(instance, self.user_field, None)

        if user and hasattr(user, "userprofile"):
            return self.encrypt(value, user.userprofile.public_key)
        # Si l'utilisateur n'a pas de clé publique, stocke en clair (optionnel)
        return value

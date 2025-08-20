from django.test import TestCase
from . import models
from datetime import datetime, timezone
from .cryptomanager import CryptoManager
# Create your tests here.


class TestTransaction(TestCase):

    def setUp(self):

        self.token_alph = models.Token.objects.create(
            name="Alephium",
            symbol="ALPH",
            decimals=18,
            is_crypto=True,
            contract_address="ABCD"
        )

        models.Metric.objects.create(
            token=self.token_alph,
            date=datetime.now(tz=timezone.utc).date(),
            usd_price=4,
        )

        self.user = models.User.objects.create(
            username="test",
        )

        self.source = models.Source.objects.create(
            user=self.user,
            label="Test source",
        )


    def test_usd_transaction(self):

        tx = models.Transaction.objects.create(
            user=self.user,
            source=self.source,
            datetime=datetime.now(tz=timezone.utc),
            amount=100,
            token=self.token_alph
        )

    def test_encrypt(self):
        DEFAULT_KEY = "59003ed3dae4f7c071ae44d6dd3f399b14a3ed843fdcccc96737224a8391237f"

        crypto_manager = CryptoManager(DEFAULT_KEY)

        message = "This is a super secret message"

        encrypted_message = crypto_manager.encrypt_data(message)
        decrypted_message = crypto_manager.decrypt_data(encrypted_message)
        assert decrypted_message == message

        decrypted_react_message = crypto_manager.decrypt_data(
            "2f7e6791fa9a7713e57f54219a5354d141390ea669c516238111fbd506688d8860a987093ecacb89f6546a1b9af7e7ad4e4a174bd415e70a8a25ba961adb212b")
        assert decrypted_react_message == "This is message before encryption"

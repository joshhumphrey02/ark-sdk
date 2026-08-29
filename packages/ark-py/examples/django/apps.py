from django.apps import AppConfig
from django.conf import settings

from ark_py import Ark


class MediaConfig(AppConfig):
    name = "media"

    def ready(self) -> None:
        # A long-lived httpx connection pool is safe to share between requests.
        # Close it from your process shutdown hook when your server provides one.
        self.ark = Ark(settings.ARK_API_TOKEN)

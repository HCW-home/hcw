"""Dev-only media serving must not become a way around the access rule."""

from django.http import Http404
from django.test import SimpleTestCase, RequestFactory

from core.urls import debug_media_serve


class DebugMediaServeTests(SimpleTestCase):
    """Under DEBUG the whole MEDIA_ROOT is served by path, with no auth.

    Message attachments are medical content, so they are cut out of that
    handler: the only way to one stays `MessageAttachmentView`, which checks
    consultation access.
    """

    def setUp(self):
        self.request = RequestFactory().get("/upload/")

    def test_attachments_are_not_served(self):
        with self.assertRaises(Http404):
            debug_media_serve(
                self.request, "tenant1/messages_attachment/result.pdf"
            )

    def test_any_tenant_schema_is_covered(self):
        with self.assertRaises(Http404):
            debug_media_serve(
                self.request, "another_tenant/messages_attachment/scan.jpg"
            )

    def test_other_media_still_goes_through(self):
        """Logos and avatars have no access rule; only attachments do."""
        with self.assertRaises(Http404) as caught:
            debug_media_serve(
                self.request,
                "tenant1/organisations/logo.png",
                document_root="/nonexistent",
            )

        # Reaching django.views.static.serve is the point: it 404s because the
        # file is absent, not because we refused to look.
        self.assertNotIn("served by the API only", str(caught.exception))

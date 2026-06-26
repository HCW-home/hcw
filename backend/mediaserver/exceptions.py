class NoMediaServerAvailable(Exception):
    """Raised when no active media server can be reached."""


class RemoteUnmuteDisabled(Exception):
    """Raised when the media server refuses a remote unmute.

    Some providers (e.g. LiveKit) disable remote unmute by default as a privacy
    safeguard: a moderator may silence a participant but not re-open their mic
    without their consent. Enabling it is a server-side configuration choice.
    """

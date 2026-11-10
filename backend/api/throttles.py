"""Rate-limiting helpers for sensitive endpoints (login / full-state sync).

The project authenticates with a custom token (not DRF authentication), so the
default ``UserRateThrottle`` cannot key on ``request.user``. These throttles key
on the resolved ``UserProfile`` (falling back to the raw token / client IP).
"""
from rest_framework.throttling import SimpleRateThrottle


def _request_token(request):
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:].strip()
    return request.headers.get('X-Auth-Token', '').strip()

class LoginRateThrottle(SimpleRateThrottle):
    """Limits login attempts per client IP to slow down brute-force attacks."""
    scope = 'login'

    def get_cache_key(self, request, view):
        return self.cache_format % {
            'scope': self.scope,
            'ident': self.get_ident(request),
        }


class ProfileRateThrottle(SimpleRateThrottle):
    """Limits a scope per authenticated profile (falls back to token / IP)."""
    scope = 'user'

    def get_cache_key(self, request, view):
        profile = getattr(request, 'user_profile', None)
        ident = (
            getattr(profile, 'pk', None)
            or _request_token(request)
            or self.get_ident(request)
        )
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class SyncRateThrottle(ProfileRateThrottle):
    """Limits the heavyweight ``/state/`` full-database sync per user."""
    scope = 'sync'

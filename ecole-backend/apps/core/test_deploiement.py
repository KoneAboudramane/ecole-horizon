"""Réglages de production : adresse IP du visiteur et cache partagé entre processus."""
import pytest
from django.core.cache import caches
from django.core.management import call_command
from django.db import connection
from django.test import RequestFactory, override_settings
from rest_framework.throttling import AnonRateThrottle

from apps.core.log import client_ip

rf = RequestFactory()


def _req(xff=None, remote="203.0.113.7"):
    extra = {"REMOTE_ADDR": remote}
    if xff is not None:
        extra["HTTP_X_FORWARDED_FOR"] = xff
    return rf.get("/", **extra)


@override_settings(NUM_PROXIES=0)
def test_sans_mandataire_x_forwarded_for_est_ignore():
    assert client_ip(_req("1.2.3.4")) == "203.0.113.7"
    assert client_ip(_req()) == "203.0.113.7"


@override_settings(NUM_PROXIES=1)
def test_un_mandataire_prend_la_derniere_adresse():
    # « 1.2.3.4 » est écrit par le visiteur ; « 198.51.100.9 » est ajouté par Caddy
    assert client_ip(_req("1.2.3.4, 198.51.100.9", remote="172.18.0.5")) == "198.51.100.9"
    assert client_ip(_req("198.51.100.9", remote="172.18.0.5")) == "198.51.100.9"
    assert client_ip(_req(None, remote="172.18.0.5")) == "172.18.0.5"
    assert client_ip(_req(" , ", remote="172.18.0.5")) == "172.18.0.5"


def test_limites_de_debit_suivent_la_meme_regle(settings):
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 0}
    from rest_framework.request import Request
    assert AnonRateThrottle().get_ident(Request(_req("1.2.3.4"))) == "203.0.113.7"


def test_client_ip_sans_requete():
    assert client_ip(None) is None


@pytest.mark.django_db(transaction=True)
def test_cache_en_base_partage_et_cree_par_migrate():
    db_cache = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "ecole_cache_test"}}
    with override_settings(CACHES=db_cache):
        from apps.core.apps import _create_cache_table
        _create_cache_table(sender=None)
        assert "ecole_cache_test" in connection.introspection.table_names()
        c = caches.create_connection("default")
        assert c.add("captcha:abc", 1, 60) is True
        assert c.add("captcha:abc", 1, 60) is False  # usage unique, visible de tous les processus
        call_command("createcachetable", verbosity=0)  # relancer ne pose pas de problème
    with connection.schema_editor() as ed:
        ed.execute(ed.sql_delete_table % {"table": ed.quote_name("ecole_cache_test")})

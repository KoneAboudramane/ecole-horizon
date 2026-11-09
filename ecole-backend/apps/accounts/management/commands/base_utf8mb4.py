"""MySQL / MariaDB : passe la base et toutes ses tables en utf8mb4 (jeu de caractères complet).

Les bases créées dans cPanel ont souvent un jeu de caractères limité (latin1…) : les apostrophes typographiques,
tirets, flèches, émojis et surtout les bulletins en arabe y sont refusés (« Incorrect string value »).
Sans effet sur une base déjà en utf8mb4 ou sur une autre base que MySQL. Lancée par les scripts O2switch avant `migrate`.
"""
from django.core.management.base import BaseCommand
from django.db import connection

COLLATION = "utf8mb4_unicode_ci"


class Command(BaseCommand):
    help = "Convertit la base MySQL/MariaDB et ses tables en utf8mb4 (sans effet si c'est déjà fait)."

    def handle(self, *a, **o):
        if connection.vendor != "mysql":
            self.stdout.write("Base non MySQL : rien à faire.")
            return
        db = connection.settings_dict["NAME"]
        qn = connection.ops.quote_name
        with connection.cursor() as c:
            c.execute("SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = %s", [db])
            row = c.fetchone()
            if row and row[0] != "utf8mb4":
                c.execute(f"ALTER DATABASE {qn(db)} CHARACTER SET utf8mb4 COLLATE {COLLATION}")
                self.stdout.write(f"Base {db} : {row[0]} → utf8mb4.")
            c.execute("SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE'", [db])
            tables = {t for t, coll in c.fetchall() if not (coll or "").startswith("utf8mb4")}
            c.execute("SELECT DISTINCT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s "
                      "AND CHARACTER_SET_NAME IS NOT NULL AND CHARACTER_SET_NAME <> 'utf8mb4'", [db])
            tables |= {r[0] for r in c.fetchall()}
            if not tables:
                self.stdout.write("Jeu de caractères : utf8mb4 (OK).")
                return
            c.execute("SET FOREIGN_KEY_CHECKS = 0")
            try:
                for t in sorted(tables):
                    c.execute(f"ALTER TABLE {qn(t)} CONVERT TO CHARACTER SET utf8mb4 COLLATE {COLLATION}")
            finally:
                c.execute("SET FOREIGN_KEY_CHECKS = 1")
        self.stdout.write(self.style.SUCCESS(f"{len(tables)} table(s) converties en utf8mb4."))

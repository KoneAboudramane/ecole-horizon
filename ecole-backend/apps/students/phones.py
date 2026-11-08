import re
from datetime import date, datetime


def digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def phone_ok(s: str) -> bool:
    return len(digits(s)) == 10


def fmt_phone(s: str) -> str:
    d = digits(s)
    return " ".join(d[i:i + 2] for i in range(0, len(d), 2))


def parse_date(s: str) -> date | None:
    for f in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), f).date()
        except ValueError:
            pass
    return None

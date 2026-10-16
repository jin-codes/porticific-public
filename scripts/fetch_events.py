#!/usr/bin/env python3
"""Refresh the market_events calendar.

- Per-ticker earnings / ex-dividend dates for every holdings + watchlist
  ticker, from yfinance (ETFs usually have none; that's fine).
- Macro dates (FOMC etc.) from data/macro_events.json, stored as ticker 'MACRO'.
  yfinance has no macro calendar, so that file is maintained by hand.

yfinance earnings dates are often the company's *expected* date and can move,
so a ticker's future yfinance rows are replaced on every run instead of merged.
"""
import datetime
import json
import sys
from pathlib import Path

import yfinance as yf

from lib.db import get_client

MACRO_PATH = Path(__file__).resolve().parents[1] / "data" / "macro_events.json"


def _as_date(value):
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    return None


def ticker_events(ticker):
    """Return [(date, kind, title)] from yfinance's calendar for one ticker."""
    cal = yf.Ticker(ticker).calendar or {}
    events = []
    for d in cal.get("Earnings Date") or []:
        d = _as_date(d)
        if d:
            events.append((d, "earnings", f"{ticker} earnings"))
    d = _as_date(cal.get("Ex-Dividend Date"))
    if d:
        events.append((d, "ex_dividend", f"{ticker} ex-dividend"))
    return events


def main():
    client = get_client()
    today = datetime.date.today()

    tickers = sorted(
        {r["ticker"] for r in client.table("holdings").select("ticker").execute().data}
        | {r["ticker"] for r in client.table("watchlist").select("ticker").execute().data}
    )

    rows = []
    for ticker in tickers:
        try:
            found = ticker_events(ticker)
        except Exception as e:
            # Keep this ticker's existing rows if the fetch failed.
            print(f"  {ticker}: calendar fetch failed ({e})", file=sys.stderr)
            continue
        client.table("market_events").delete().eq("ticker", ticker).eq("source", "yfinance").gte(
            "event_date", today.isoformat()
        ).execute()
        for d, kind, title in found:
            if d >= today:
                rows.append({"ticker": ticker, "event_date": d.isoformat(), "kind": kind,
                             "title": title, "source": "yfinance"})
        print(f"  {ticker}: {len(found)} events", file=sys.stderr)

    if MACRO_PATH.exists():
        for e in json.loads(MACRO_PATH.read_text()):
            if e["date"] >= today.isoformat():
                rows.append({"ticker": "MACRO", "event_date": e["date"], "kind": "macro",
                             "title": e["title"], "source": "manual"})

    if rows:
        client.table("market_events").upsert(rows, on_conflict="ticker,event_date,kind").execute()
    print(f"Upserted {len(rows)} events.", file=sys.stderr)


if __name__ == "__main__":
    main()

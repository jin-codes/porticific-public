#!/usr/bin/env python3
"""Fetch latest prices for every holdings/watchlist ticker via yfinance,
upsert them into daily_snapshots (one row per ticker/day), and append them to
intraday_snapshots (one row per fetch) so the dashboard chart can show
intraday movement. Prints a JSON summary to stdout so a Claude Code session
running the daily workflow can read the results directly.
"""
import json
import math
import sys
from datetime import datetime, timedelta, timezone

import yfinance as yf

from lib.db import get_client

INTRADAY_RETENTION_DAYS = 14


def get_tickers(client):
    holdings = client.table("holdings").select("ticker").execute().data
    watchlist = client.table("watchlist").select("ticker").execute().data
    return sorted({row["ticker"] for row in holdings} | {row["ticker"] for row in watchlist})


def fetch_one(ticker: str):
    hist = yf.Ticker(ticker).history(period="5d")
    # yfinance can return a trailing row with a NaN Close (e.g. right before
    # the market opens); NaN isn't JSON-serializable, so fall back to the last
    # valid close.
    hist = hist.dropna(subset=["Close"])
    if hist.empty:
        return None

    last = hist.iloc[-1]
    price = float(last["Close"])

    try:
        volume = int(last["Volume"])
    except (TypeError, ValueError):
        volume = None

    change_pct = None
    if len(hist) >= 2:
        prev_close = float(hist.iloc[-2]["Close"])
        if prev_close and not math.isnan(prev_close):
            change_pct = round((price - prev_close) / prev_close * 100, 4)

    return {
        "ticker": ticker,
        "date": hist.index[-1].date().isoformat(),
        "price": round(price, 4),
        "change_pct": change_pct,
        "volume": volume,
    }


def main():
    client = get_client()
    tickers = get_tickers(client)
    if not tickers:
        print("No tickers in holdings/watchlist.", file=sys.stderr)
        return

    # Shared timestamp for this whole run, so every ticker's intraday row
    # lands in the same bucket and the dashboard chart can group them into
    # one portfolio-value point instead of one point per ticker per fetch.
    run_ts = datetime.now(timezone.utc).isoformat()

    results = []
    for ticker in tickers:
        try:
            snap = fetch_one(ticker)
        except Exception as e:
            print(f"  {ticker}: fetch failed ({e})", file=sys.stderr)
            continue
        if snap is None:
            print(f"  {ticker}: no data", file=sys.stderr)
            continue

        client.table("daily_snapshots").upsert(snap, on_conflict="ticker,date").execute()
        client.table("intraday_snapshots").insert({
            "ticker": snap["ticker"],
            "ts": run_ts,
            "price": snap["price"],
            "change_pct": snap["change_pct"],
            "volume": snap["volume"],
        }).execute()
        results.append(snap)
        pct = f"{snap['change_pct']}%" if snap["change_pct"] is not None else "-"
        print(f"  {snap['ticker']}: {snap['price']} ({pct})", file=sys.stderr)

    cutoff = (datetime.now(timezone.utc) - timedelta(days=INTRADAY_RETENTION_DAYS)).isoformat()
    client.table("intraday_snapshots").delete().lt("ts", cutoff).execute()

    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

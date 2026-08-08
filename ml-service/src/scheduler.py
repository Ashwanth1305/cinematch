"""
CineMatch ML Engine — EOD Retraining Scheduler

Schedules and executes the end-of-day (2:00 AM) model retraining pipeline:
  1. Extract and normalize live ratings/aspects from PostgreSQL (sync_feedback.py)
  2. Run the 12-step ML training pipeline (train.py)
  3. Send HTTP POST /reload to FastAPI ML Service to hot-reload model bundle atomically

Usage:
  python -m src.scheduler         # Runs background daemon scheduled for 02:00 AM daily
  python -m src.scheduler --now   # Executes retrain cycle immediately for testing
"""

import argparse
import logging
import sys
import time
import requests
import schedule

from .sync_feedback import sync_and_export_feedback

logger = logging.getLogger(__name__)

FASTAPI_RELOAD_URL = "http://localhost:8000/reload"


def run_retrain_cycle():
    """Execute the full end-of-day retraining workflow."""
    logger.info("======================================================================")
    logger.info("⏰ Starting CineMatch EOD Model Retraining Cycle ...")
    logger.info("======================================================================")
    start_time = time.time()

    # Step 1: Sync live user feedback from PostgreSQL
    logger.info("📥 Step 1/3: Syncing live user feedback from PostgreSQL ...")
    try:
        exported_file = sync_and_export_feedback()
        if exported_file:
            logger.info("✓ Live user feedback synced and exported to %s", exported_file)
        else:
            logger.info("ℹ️ No new live feedback to sync.")
    except Exception as e:
        logger.error("❌ Failed to sync feedback from PostgreSQL: %s", e)

    # Step 2: Run training orchestrator
    logger.info("🧠 Step 2/3: Launching training orchestrator (train.py) ...")
    try:
        from . import train
        train.main()
        logger.info("✓ Model training completed successfully.")
    except Exception as e:
        logger.error("❌ Training orchestrator failed: %s", e, exc_info=True)
        return False

    # Step 3: Trigger zero-downtime hot-reload on FastAPI ML Service
    logger.info("🔄 Step 3/3: Requesting atomic model hot-reload from FastAPI service ...")
    try:
        resp = requests.post(FASTAPI_RELOAD_URL, timeout=10)
        if resp.status_code == 200:
            logger.info("✓ FastAPI hot-reload succeeded: %s", resp.json())
        else:
            logger.warning("⚠️ FastAPI hot-reload returned status %d: %s", resp.status_code, resp.text)
    except Exception as e:
        logger.warning("⚠️ Could not reach FastAPI service at %s (service may be offline): %s", FASTAPI_RELOAD_URL, e)

    elapsed = (time.time() - start_time) / 60.0
    logger.info("======================================================================")
    logger.info("✅ CineMatch EOD Retraining Cycle finished in %.2f minutes", elapsed)
    logger.info("======================================================================")
    return True


def main():
    parser = argparse.ArgumentParser(description="CineMatch EOD Retraining Scheduler")
    parser.add_argument("--now", action="store_true", help="Execute retraining cycle immediately instead of waiting for 02:00 AM")
    parser.add_argument("--time", default="02:00", help="Daily execution time in HH:MM format (default: 02:00)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.now:
        logger.info("Executing immediate retrain cycle (--now flag detected) ...")
        run_retrain_cycle()
        return

    logger.info("Scheduling daily retrain cycle at %s AM/PM ...", args.time)
    schedule.every().day.at(args.time).do(run_retrain_cycle)

    logger.info("Scheduler daemon active. Waiting for next run ... (Press Ctrl+C to stop)")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()

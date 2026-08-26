"""Octagon — minimal farm seeder. 4 tables only."""
import sys, sqlite3, uuid, random
from pathlib import Path
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/"engine"))
from octragon.db import OctagonDB

def main():
    p = ROOT/"infra"/"db"/"farm.db"
    for e in ("","-shm","-wal"):
        try: (Path(str(p)+e) if e else p).unlink()
        except: pass
    OctagonDB(p)
    print(f"✓ {p} ready")
    db=sqlite3.connect(p)
    now=datetime.now(timezone.utc)
    iso=lambda d: d.isoformat()

    # health — 3 live, 1 idle
    for did,usb,st,sw,li in [("phone1",1,"warmup",3421,812),("phone2",1,"posting",2893,654),("phone3",0,"idle",452,120),("phone4",1,"warmup",1765,432)]:
        db.execute("UPDATE farm_device_health SET usb_connected=?,session_state=?,swipes=?,likes=?,last_action=?,last_action_at=?,updated_at=? WHERE device_id=?",
                   (usb,st,sw,li,"Swipe Next",iso(now),iso(now),did))

    # tasks
    for tid,typ,dev,stat in [("task_warmup_1","warmup","phone1","running"),("task_post_2","post","phone2","scheduled"),("task_warmup_3","warmup","phone4","scheduled"),("task_audit_1","audit",None,"succeeded")]:
        db.execute("INSERT OR REPLACE INTO farm_tasks (id,type,device_id,scheduled_for,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                   (tid,typ,dev,iso(now),stat,'{}',iso(now),iso(now)))

    # events — grok-style chat bubbles
    evts=[
        ("US evening: 0 replies. Nothing cleared 12x that was actually our ICP (closest was a Turkish Trendyol tax rant, skipped).","phone1"),
        ("Shipped one original off the unused angle instead — link is in the queue for review.","phone1"),
        ("Last hourly: still no gold. Didn't pad. Original already went out this hour so nothing else to ship.","phone2"),
        ("Ran the nightly learn pass — numbers clear enough to change playbook. Harvested all 41 ships. Replies: median 14 views, best 324. Fillers in dead hours are worth nothing. Two changes: zero-gold hour = no post at all.","phone4"),
        ("Cron minutes re-rolled too, hourly to :17 and the evening wave to 20:27.","phone4"),
        ("Warmup sweep Alpha: 3421 swipes, 812 likes, jitter 0.34 — healthy","phone1"),
        ("Posting Delta: 18 of 18 posted. You didn't touch it.","phone4"),
    ]
    for i,(msg,did) in enumerate(evts):
        ts=now - timedelta(hours=len(evts)-i, minutes=random.randint(0,50))
        db.execute("INSERT OR REPLACE INTO farm_events (id,ts,level,device_id,event,data) VALUES (?,?,?,?,?,?)",
                   (f"evt{i:02d}", iso(ts), "info", did, msg, "{}"))
    db.commit()
    print(f"✓ seeded {db.execute('SELECT COUNT(*) FROM farm_devices').fetchone()[0]} devices, {db.execute('SELECT COUNT(*) FROM farm_events').fetchone()[0]} events")
    db.close()

if __name__=="__main__": main()

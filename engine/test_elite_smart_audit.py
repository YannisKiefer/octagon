import asyncio
import os
import json
from octragon.config import OctragonConfig
from octragon.cmo.agent import CMOAgent
from loguru import logger

async def test_jaedits_smart_audit():
    config = OctragonConfig()
    agent = CMOAgent(config)
    
    handle = "jaedits66"
    logger.info(f"🚀 STARTING ELITE SMART AUDIT FOR @{handle}")
    
    try:
        result = await agent.audit_account_smart(handle)
        
        print("\n" + "═"*50)
        print(f"🏆 AUDIT COMPLETE FOR @{handle}")
        print("═"*50)
        print(json.dumps(result, indent=2))
        print("═"*50 + "\n")
        
        if "error" in result:
            logger.error(f"Audit failed: {result['error']}")
        else:
            logger.success("Elite Audit Successful!")
            
    except Exception as e:
        logger.exception(f"Fatal error during smart audit: {e}")
    finally:
        agent.close()

if __name__ == "__main__":
    asyncio.run(test_jaedits_smart_audit())

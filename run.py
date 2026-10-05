import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run("otel_cost.server:app", host=os.getenv("HOST", "127.0.0.1"),
                port=int(os.getenv("PORT", "4318")))

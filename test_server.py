import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import server
from store import UsageStore


class DeleteUserUsageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_store = server.store
        server.store = UsageStore(self.temp_dir.name)

    def tearDown(self):
        server.store = self.original_store
        self.temp_dir.cleanup()

    def test_delete_requires_separate_configured_bearer_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as error:
                server.delete_user_usage("alice", "Bearer secret")
        self.assertEqual(error.exception.status_code, 503)

        with patch.dict(os.environ, {"USER_DATA_DELETE_TOKEN": "admin-secret"}):
            with self.assertRaises(HTTPException) as error:
                server.delete_user_usage("alice", "Bearer wrong-secret")
            self.assertEqual(error.exception.status_code, 401)

            result = server.delete_user_usage("alice", "Bearer admin-secret")
        self.assertEqual(result, {"user": "alice", "deleted_events": 0})


if __name__ == "__main__":
    unittest.main()
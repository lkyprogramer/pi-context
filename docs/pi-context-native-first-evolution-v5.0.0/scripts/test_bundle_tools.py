#!/usr/bin/env python3
import copy
import json
import sqlite3
import unittest
from pathlib import Path
import validate_bundle as tool
ROOT=Path(__file__).resolve().parents[1]
class BundleTests(unittest.TestCase):
    def test_example_config(self):
        cfg=json.loads((ROOT/'contracts/config.example.json').read_text())
        schema=json.loads((ROOT/'contracts/config.schema.json').read_text())
        self.assertEqual(tool.check_schema(cfg,schema),[])
    def test_unknown_config_rejected(self):
        cfg=json.loads((ROOT/'contracts/config.example.json').read_text());cfg['sendAllHistory']=True
        schema=json.loads((ROOT/'contracts/config.schema.json').read_text())
        self.assertTrue(tool.check_schema(cfg,schema))
    def test_content_logging_rejected(self):
        cfg=json.loads((ROOT/'contracts/config.example.json').read_text());cfg['telemetry']['includeContent']=True
        schema=json.loads((ROOT/'contracts/config.schema.json').read_text())
        self.assertTrue(tool.check_schema(cfg,schema))
    def test_graph_cycle(self):
        with self.assertRaises(ValueError):tool.topological([{'id':'A','dependsOn':['B']},{'id':'B','dependsOn':['A']}])
    def test_graph_missing_dep(self):
        with self.assertRaises(ValueError):tool.topological([{'id':'A','dependsOn':['missing']}])
    def test_real_graph_is_complete(self):
        tasks=json.loads((ROOT/'tasks/task-graph.json').read_text())['tasks']
        self.assertEqual(len(tool.topological(tasks)),26)
    def test_sqlite_schema_integrity(self):
        db=sqlite3.connect(':memory:');db.executescript((ROOT/'contracts/index.sql').read_text())
        db.execute('INSERT INTO source_entries VALUES (?,?,?,?,?,?,?)',('w','s','e',None,'a'*64,'message','2026-09-06'))
        db.execute('INSERT INTO indexed_text(workspace_id,session_id,entry_id,field_key,body,source_hash) VALUES (?,?,?,?,?,?)',('w','s','e','text:0','alpha evidence','a'*64))
        self.assertEqual(db.execute("SELECT count(*) FROM text_fts WHERE text_fts MATCH 'alpha'").fetchone()[0],1)
        db.execute("UPDATE indexed_text SET body='beta evidence'")
        self.assertEqual(db.execute("SELECT count(*) FROM text_fts WHERE text_fts MATCH 'alpha'").fetchone()[0],0)
        self.assertEqual(db.execute("SELECT count(*) FROM text_fts WHERE text_fts MATCH 'beta'").fetchone()[0],1)
        db.execute("DELETE FROM source_entries")
        self.assertEqual(db.execute("SELECT count(*) FROM text_fts WHERE text_fts MATCH 'beta'").fetchone()[0],0)
        db.close()
if __name__=='__main__':unittest.main(verbosity=2)

import duckdb
from trialbridge.search_executor import execute_proprietary_search
from trialbridge.search_spec import ClinicalSearchSpec


def test_aggregate_executor_separates_payer_and_suppresses_sites():
    con=duckdb.connect()
    con.execute("""CREATE TABLE proprietary_docs(
      unique_patient_id VARCHAR, primary_icd VARCHAR, gender VARCHAR, birth_year INTEGER,
      created_ts TIMESTAMP, texto VARCHAR, convenio VARCHAR, hospital VARCHAR)""")
    rows=[]
    for i in range(8):
        rows.append((f"sus{i}","C509","FEMALE",1970,"2025-01-01","HER2 positivo","SUS","ha"))
    for i in range(6):
        rows.append((f"priv{i}","C509","FEMALE",1975,"2025-01-01","HER2 positivo","UNIMED","hmv"))
    rows += [("unk","C509","FEMALE",1980,"2025-01-01","HER2 positivo",None,"tiny")]
    con.executemany("INSERT INTO proprietary_docs VALUES (?,?,?,?,?,?,?,?)",rows)
    spec=ClinicalSearchSpec.model_validate({
      "version":1,"consultation_id":"c","as_of":"2026-07-12","reference_year":2026,
      "diagnosis":{"concepts":["breast"],"cid10_prefixes":["C50"]},
      "stages":[
        {"id":"base","kind":"INCLUSAO","query":{"filter":[{"type":"age","min_age":18}]}},
        {"id":"her2","kind":"INCLUSAO","query":{"must":[{"type":"text","terms":["HER2 positivo"],"tier":2}]}}
      ]})
    result=execute_proprietary_search(con,spec,min_cell=5)
    assert result["shallow_n"]==15 and result["deep_n"]==15
    assert result["by_payer"]=={"sus":8,"private":6,"unknown":1}
    assert [x["hospital_code"] for x in result["by_hospital"]]==["ha","hmv"]
    assert result["sus_bridge"]["depth_rate"]==1.0
    assert len(result["funnel"])==2


def test_any_sus_document_wins_patient_payer_classification():
    con=duckdb.connect()
    con.execute("""CREATE TABLE proprietary_docs(unique_patient_id VARCHAR, primary_icd VARCHAR,
      gender VARCHAR,birth_year INTEGER,created_ts TIMESTAMP,texto VARCHAR,convenio VARCHAR,hospital VARCHAR)""")
    con.executemany("INSERT INTO proprietary_docs VALUES (?,?,?,?,?,?,?,?)",[
      ("p","C509","FEMALE",1970,"2025-01-01","cancer","UNIMED","ha"),
      ("p","C509","FEMALE",1970,"2025-02-01","cancer","SUS","ha")])
    spec=ClinicalSearchSpec.model_validate({"version":1,"consultation_id":"c","as_of":"2026-07-12","reference_year":2026,"diagnosis":{"concepts":["breast"],"cid10_prefixes":["C50"]},"stages":[{"id":"base","kind":"INCLUSAO","query":{}}]})
    assert execute_proprietary_search(con,spec,min_cell=1)["by_payer"]["sus"]==1

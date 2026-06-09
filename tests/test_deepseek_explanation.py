from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

import prediction_service


class DeepSeekExplanationTests(unittest.TestCase):
    def test_deepseek_prompt_changes_with_composition(self) -> None:
        low_alloy = {
            "input": {
                "material_subclass": "alloy_steel",
                "composition": {
                    "comp_C_wtpct": 0.18,
                    "comp_Cr_wtpct": 1.0,
                    "comp_Ni_wtpct": 1.2,
                    "comp_Mo_wtpct": 0.2,
                },
                "process_text": "900C quench + 600C temper",
            },
            "predictions": {"mechanical": {}, "physical": {}},
            "explanation": {
                "composition_mechanism": {
                    "summary": "低合金钢模板说明",
                    "mechanism_notes": ["Cr/Mo 贡献淬透性"],
                }
            },
        }
        stainless = {
            "input": {
                "material_subclass": "stainless_steel",
                "composition": {
                    "comp_C_wtpct": 0.04,
                    "comp_Cr_wtpct": 18.0,
                    "comp_Ni_wtpct": 8.0,
                    "comp_Mo_wtpct": 2.0,
                },
                "process_text": "solution annealed",
            },
            "predictions": {"mechanical": {}, "physical": {}},
            "explanation": {
                "composition_mechanism": {
                    "summary": "不锈钢模板说明",
                    "mechanism_notes": ["Cr/Ni 贡献耐蚀与奥氏体稳定性"],
                }
            },
        }

        low_prompt = prediction_service.build_deepseek_messages(low_alloy)[1]["content"]
        stainless_prompt = prediction_service.build_deepseek_messages(stainless)[1]["content"]

        self.assertIn("alloy_steel", low_prompt)
        self.assertIn("stainless_steel", stainless_prompt)
        self.assertIn("Cr=1", low_prompt)
        self.assertIn("Cr=18", stainless_prompt)
        self.assertNotEqual(low_prompt, stainless_prompt)

    def test_deepseek_is_not_called_without_api_key(self) -> None:
        payload = {
            "input": {
                "material_subclass": "alloy_steel",
                "composition": {"comp_C_wtpct": 0.18},
                "process_text": "",
            },
            "predictions": {"mechanical": {}, "physical": {}},
            "explanation": {
                "composition_mechanism": {
                    "summary": "模板说明",
                    "mechanism_notes": ["碳影响强度"],
                }
            },
        }

        result = prediction_service.enhance_explanation_with_deepseek(payload, api_key="")

        self.assertFalse(result["enabled"])
        self.assertEqual(result["status"], "missing_api_key")
        self.assertIsNone(result["text"])


if __name__ == "__main__":
    unittest.main()

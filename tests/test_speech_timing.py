import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec=importlib.util.spec_from_file_location('speech_timing',Path(__file__).resolve().parents[1]/'scripts/speech_timing.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class SpeechTimingTest(unittest.TestCase):
    def timings(self,groups):
        return [SimpleNamespace(phoneme=letter,start=index*.1,end=(index+1)*.1)for index,letter in enumerate(' '.join(groups))]

    def test_expanded_written_words_keep_all_spoken_units_and_real_pause_offsets(self):
        spoken=self.timings(['save','twenty','percent','today.'])
        for item in spoken:
            if item.start>=2:item.start+=.27;item.end+=.27
        result=module.spoken_words('Save 20% today.',spoken,lambda text:{'Save':'save','20%':'twenty percent','today.':'today.'}[text],4)
        self.assertEqual([word['text']for word in result],['Save','20%','today.'])
        self.assertAlmostEqual(result[1]['start'],.5)
        self.assertAlmostEqual(result[1]['end'],1.9)
        self.assertAlmostEqual(result[2]['start'],2.27)
        self.assertAlmostEqual(result[2]['end'],2.77)

    def test_ambiguous_word_counts_and_unspoken_units_are_rejected_instead_of_spread_evenly(self):
        with self.assertRaisesRegex(ValueError,'do not map reliably'):
            module.spoken_words('New York',self.timings(['differentphonemes']),lambda text:text.lower(),3)
        with self.assertRaisesRegex(ValueError,'do not map reliably'):
            module.spoken_words('Go — now.',self.timings(['go','now.']),lambda text:''if text=='—'else text.lower(),3)

    def test_joined_function_words_split_only_at_exact_model_phoneme_boundaries(self):
        spoken=self.timings(['start','withthe','grounds.'])
        result=module.spoken_words('Start with the grounds.',spoken,lambda text:text.lower(),4)
        self.assertEqual([word['text']for word in result],['Start','with','the','grounds.'])
        self.assertAlmostEqual(result[1]['start'],.6)
        self.assertAlmostEqual(result[1]['end'],1.0)
        self.assertAlmostEqual(result[2]['start'],1.0)
        self.assertAlmostEqual(result[2]['end'],1.3)
        # An item spanning the proposed boundary has no measured split time.
        merged=[SimpleNamespace(phoneme='withthe',start=0,end=1)]
        with self.assertRaisesRegex(ValueError,'do not map reliably'):
            module.spoken_words('with the',merged,lambda text:text,1)

    def test_invalid_or_overlapping_model_intervals_do_not_become_title_timings(self):
        spoken=self.timings(['go','now']);spoken[-1].end=0
        with self.assertRaisesRegex(ValueError,'unusable'):
            module.spoken_words('Go now',spoken,lambda text:text.lower(),3)


if __name__=='__main__':unittest.main()

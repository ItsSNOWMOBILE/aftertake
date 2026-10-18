import importlib.util
import json
import math
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import av
import numpy as np
import torch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('aftertake_character_tests',ROOT/'custom_nodes/aftertake/__init__.py')
nodes=importlib.util.module_from_spec(spec);sys.modules[spec.name]=nodes;spec.loader.exec_module(nodes)
character=sys.modules[spec.name+'.character_nodes']

class CharacterNodeTests(unittest.TestCase):
    def test_clicks_follow_aspect_preserving_source_crop(self):
        images=torch.zeros(1,512,960,3)
        positive,negative=character.AftertakeSubjectPoints().execute(images,json.dumps({'positive':[{'x':.5,'y':.5}],
            'negative':[{'x':.5,'y':0}]}),1920,1080)
        self.assertEqual(json.loads(positive),[{'x':480,'y':256}]);self.assertEqual(json.loads(negative),[])
        with self.assertRaisesRegex(ValueError,'outside'):
            character.AftertakeSubjectPoints().execute(images,json.dumps({'positive':[{'x':.5,'y':0}]}),1920,1080)

    def test_overlapping_people_need_disambiguation(self):
        masks=torch.zeros(2,64,64);masks[0,:,:40]=1;masks[1,:,24:]=1
        select=character.AftertakeSelectCharacterMask()
        with self.assertRaisesRegex(ValueError,'more than one person'):
            select.execute(masks,'[{"x":32,"y":32}]','[]')
        chosen=select.execute(masks,'[{"x":32,"y":32}]','[{"x":4,"y":32}]')[0]
        self.assertTrue(torch.equal(chosen,masks[1:]))
        with self.assertRaisesRegex(ValueError,'No detected person'):
            select.execute(masks,'[{"x":32,"y":32}]','[{"x":32,"y":32}]')

    def test_mask_timeline_is_not_resampled_or_stretched(self):
        masks=torch.zeros(24,64,64);masks[:,16:48,16:48]=1
        aligned=character.AftertakeAlignCharacterMask().execute(masks,torch.zeros(39,64,64,3),24)[0]
        self.assertTrue(torch.equal(aligned[:24],masks));self.assertTrue(torch.equal(aligned[24:],masks[-1:].expand(15,-1,-1)))
        with self.assertRaisesRegex(ValueError,'does not match'):
            character.AftertakeAlignCharacterMask().execute(masks,torch.zeros(39,64,96,3),24)
        masks[12]=0
        with self.assertRaisesRegex(ValueError,'lost'):
            character.AftertakeAlignCharacterMask().execute(masks,torch.zeros(39,64,64,3),24)

    def test_lossless_mask_roundtrip_reports_gaps_and_keeps_workflow_json_valid(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-mask-')as directory:
            fake=types.SimpleNamespace(get_output_directory=lambda:directory,
                get_save_image_path=lambda prefix,output:(directory,'selection',1,'',prefix))
            masks=torch.zeros(24,64,64)
            for i in range(24):masks[i,12:48,8+i:32+i]=1
            masks[12]=0
            prompt={'node':{'class_type':'NativeNode','inputs':{'text':'Literal NaN stays text'},'is_changed':[math.nan]}}
            with patch.dict(sys.modules,{'folder_paths':fake}):
                result=character.AftertakeSaveCharacterSelection().execute(torch.rand(24,64,64,3),masks,'selection','{"format":"test"}',prompt)
            mask_file=Path(directory)/result['ui']['gifs'][0]['filename']
            with av.open(str(mask_file))as container:
                decoded=[f.to_ndarray(format='gray')for f in container.decode(video=0)]
            self.assertEqual(len(decoded),24)
            for i,frame in enumerate(decoded):np.testing.assert_array_equal(frame,(masks[i].numpy()*255).astype(np.uint8))
            preview=Path(directory)/result['ui']['gifs'][1]['filename']
            with av.open(str(preview))as container:
                metadata=json.loads(container.metadata['comment'],parse_constant=lambda value:(_ for _ in ()).throw(ValueError(value)))
                self.assertEqual(len(list(container.decode(video=0))),24)
            self.assertEqual(metadata['recipe']['selection']['emptyFrames'],[12])
            self.assertEqual(metadata['workflow']['node']['inputs']['text'],'Literal NaN stays text')
            self.assertNotIn('is_changed',metadata['workflow']['node'])

    def test_export_does_not_silently_repair_nonfinite_model_inputs(self):
        with self.assertRaises(ValueError):
            json.dumps(nodes.export_prompt({'n':{'class_type':'BadInput','inputs':{'strength':math.nan}}}),allow_nan=False)

if __name__=='__main__':unittest.main()

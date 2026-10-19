"""Analytic independent color vectors and real PNG/video grade exports."""
import colorsys
from copy import deepcopy
from fractions import Fraction
from hashlib import sha256
import importlib.util
from pathlib import Path
import tempfile
import unittest

import av
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('grading_finisher',ROOT/'scripts/finish-media.py')
finish=importlib.util.module_from_spec(spec);spec.loader.exec_module(finish)
grade=finish.grading


def cube_bytes(transform=lambda r,g,b:(r,g,b),domain=None):
    lines=['TITLE "Analytic fixture"','LUT_3D_SIZE 2']
    if domain:
        lines += ['DOMAIN_MIN '+' '.join(map(str,domain[0])), 'DOMAIN_MAX '+' '.join(map(str,domain[1]))]
    for b in (0,1):
        for g in (0,1):
            for r in (0,1):lines.append(' '.join(map(str,transform(r,g,b))))
    return ('\n'.join(lines)+'\n').encode()


def descriptor(data):
    parsed=grade.parse_cube(data)
    return {key:parsed[key] for key in ('title','size','domainMin','domainMax')} | {
        'sha256':sha256(data).hexdigest(),'interpolation':'trilinear','colorSpace':'srgb'}


class GradingTest(unittest.TestCase):
    def test_eight_hsl_channels_overlap_smoothly_and_protect_neutrals(self):
        wheel=np.array([[colorsys.hls_to_rgb(h/360,.5,1) for h in (0,15,30,60,120,180,240,270,300,359.99,.01)]],dtype=np.float32)
        values=np.zeros((8,3),dtype=np.float32);values[0,0]=20
        adjusted=grade.selective_hsl(wheel,values)
        self.assertAlmostEqual(colorsys.rgb_to_hls(*adjusted[0,0])[0]*360,20,places=4)
        self.assertAlmostEqual(colorsys.rgb_to_hls(*adjusted[0,1])[0]*360,25,places=4)
        np.testing.assert_allclose(adjusted[:,2:9],wheel[:,2:9],atol=1e-6)
        self.assertLess(float(np.max(np.abs(adjusted[0,-2]-adjusted[0,-1]))),.001)
        gray=np.repeat(np.linspace(0,1,31,dtype=np.float32)[None,:,None],3,axis=2)
        aggressive=np.tile([30,1,1],(8,1)).astype(np.float32)
        np.testing.assert_array_equal(grade.selective_hsl(gray,aggressive),gray)
        values[:]=0;values[2,2]=.3
        bright=grade.selective_hsl(wheel,values)
        self.assertTrue(np.all(bright[0,3]>=wheel[0,3]))
        self.assertGreater(float(bright[0,3,2]),float(wheel[0,3,2]))
        np.testing.assert_array_equal(bright[0,6],wheel[0,6])

    def test_pchip_curves_are_monotone_no_overshoot_and_master_runs_first(self):
        points=[dict(x=0,y=.1),dict(x=.2,y=.15),dict(x=.7,y=.85),dict(x=1,y=.9)]
        table=grade.curve_table(points)
        self.assertTrue(np.all(np.diff(table)>=0))
        self.assertGreaterEqual(float(table.min()),.1-1e-7)
        self.assertLessEqual(float(table.max()),.9+1e-7)
        for point in points:
            self.assertAlmostEqual(float(np.interp(point['x'],np.linspace(0,1,4096),table)),point['y'],delta=2e-5)
        image=np.full((1,1,3),.25,dtype=np.float32)
        tables={'master':grade.curve_table([dict(x=0,y=.2),dict(x=1,y=1)]),
                'red':grade.curve_table([dict(x=0,y=0),dict(x=1,y=.5)])}
        result=grade.apply_curves(image,tables)
        np.testing.assert_allclose(result,[[(.2,.4,.4)]],atol=1e-6)
        np.testing.assert_array_equal(image,np.full((1,1,3),.25,dtype=np.float32))
        plateau=grade.curve_table([dict(x=0,y=.1),dict(x=.3,y=.1),dict(x=.6,y=.7),dict(x=1,y=.7)])
        self.assertTrue(np.all(np.diff(plateau)>=-1e-7))

    def test_lut_red_fastest_trilinear_input_domain_and_unclamped_output(self):
        identity=grade.parse_cube(cube_bytes())
        self.assertEqual(grade.parse_cube(cube_bytes().replace(b'"Analytic fixture"',b'"  A # title  "'))['title'],'A # title')
        self.assertEqual(grade.parse_cube(cube_bytes().replace(b'"Analytic fixture"',b'""'))['title'],'Imported LUT')
        source=np.array([[[.2,.4,.7],[0,1,.5]]],dtype=np.float32)
        np.testing.assert_allclose(grade.apply_lut(source,identity,1),source,atol=1e-7)
        swap=grade.parse_cube(cube_bytes(lambda r,g,b:(b,r,g)))
        np.testing.assert_allclose(grade.apply_lut(source,swap,1),source[...,[2,0,1]],atol=1e-7)
        nonunit=grade.parse_cube(cube_bytes(domain=([.2,.2,.2],[.8,.8,.8])))
        ramp=np.array([[[.2,.5,.8]]],dtype=np.float32)
        np.testing.assert_allclose(grade.apply_lut(ramp,nonunit,1),[[[0,.5,1]]],atol=1e-7)
        extended=grade.parse_cube(cube_bytes(lambda r,g,b:(r*2-.5,g*3-.25,b)))
        values=grade.apply_lut(np.array([[[1,0,.5]]],dtype=np.float32),extended,1)
        np.testing.assert_allclose(values,[[[1.5,-.25,.5]]],atol=1e-7)
        np.testing.assert_allclose(grade.apply_lut(source,swap,.4),source*.6+source[...,[2,0,1]]*.4,atol=1e-7)
        tall=np.tile(source,(130,7,1))
        np.testing.assert_array_equal(grade.apply_lut(tall,swap,1,rows=7),grade.apply_lut(tall,swap,1,rows=64))

    def test_invalid_grades_and_cube_assets_fail_without_silent_identity(self):
        for points in ([],[dict(x=0,y=0),dict(x=0,y=1)],
                       [dict(x=0,y=.8),dict(x=1,y=.2)],
                       [dict(x=0,y=0),dict(x=1,y=float('nan'))]):
            settings=deepcopy(finish.DEFAULTS);settings['curves']['master']=points
            with self.assertRaises(ValueError):finish.validate_settings(settings)
        data=cube_bytes()
        for bad in (data+b'0 0 0\n',data.rsplit(b'\n',2)[0],data.replace(b'LUT_3D_SIZE 2',b'LUT_1D_SIZE 2'),
                    data.replace(b'0 0 0',b'nan 0 0',1),data.replace(b'0 0 0',b'1e100 0 0',1),
                    data+b'DOMAIN_MIN 0 0 0\n',data.replace(b'LUT_3D_SIZE 2',b'LUT_3D_SIZE 65')):
            with self.subTest(data=bad[:50]),self.assertRaises((ValueError,UnicodeError)):grade.parse_cube(bad)
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'look.cube';path.write_bytes(data)
            settings=deepcopy(finish.DEFAULTS);settings.update(lut=descriptor(data),lutStrength=1)
            context=finish.prepare_grading_context(settings,path)
            self.assertIsNotNone(context['lut'])
            image=Image.fromarray(np.random.default_rng(18).integers(0,256,(31,43,3),dtype=np.uint8))
            np.testing.assert_array_equal(np.asarray(finish.apply_finishing(image,settings,grading_context=context)),np.asarray(image))
            with self.assertRaisesRegex(ValueError,'matching'):finish.prepare_grading_context(settings)
            path.write_bytes(data+b'#changed\n')
            with self.assertRaisesRegex(ValueError,'hash'):finish.prepare_grading_context(settings,path)
            settings['lutStrength']=0
            self.assertIsNone(finish.prepare_grading_context(settings)['lut'])

    def test_real_png_preview_and_export_share_advanced_grade_and_companion(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);source=folder/'source.png'
            Image.fromarray(np.random.default_rng(14).integers(0,256,(48,64,3),dtype=np.uint8)).save(source)
            data=cube_bytes(lambda r,g,b:(r*.8+.1,g*.9,b*.75+.1))
            lut=folder/'look.cube';lut.write_bytes(data)
            settings=deepcopy(finish.DEFAULTS)
            settings['selectiveColor']['orange']['saturation']=-.3
            settings['curves']['master']=[dict(x=0,y=.03),dict(x=.4,y=.33),dict(x=1,y=.96)]
            settings.update(lut=descriptor(data),lutStrength=.7)
            clip=dict(id='11111111-1111-4111-8111-111111111111',name='Source',kind='image',width=64,height=48,
                      duration=1,sha256=finish.file_hash(source),url='/media/source.png')
            work=dict(source=str(source),request={'format':'aftertake-finishing/1','name':'Graded','clip':clip,'settings':settings},
                      resolvedLuts={settings['lut']['sha256']:str(lut)})
            finish.process({**work,'output':str(folder/'final.png')})
            finish.process({**work,'output':str(folder/'preview.png'),'mode':'preview','time':0})
            self.assertEqual((folder/'final.png').read_bytes(),(folder/'preview.png').read_bytes())
            self.assertNotEqual((folder/'final.png').read_bytes(),source.read_bytes())


if __name__=='__main__':unittest.main()

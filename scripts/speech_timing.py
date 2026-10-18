"""Map Kokoro's model-duration phonemes back to written words conservatively."""
import re

PUNCTUATION='.,!?;:…—–-()[]{}\"\''


def exact_phoneme_units(words,timings,phonemize):
    """Split joined speech groups only at exact recorded phoneme boundaries."""
    def clean(value):return ''.join(ch for ch in value if not ch.isspace() and ch not in PUNCTUATION)
    expected=[clean(phonemize(word)) for word in words]
    actual=[(item,clean(item.phoneme))for item in timings if clean(item.phoneme)]
    if any(not value for value in expected) or ''.join(expected)!=''.join(value for _,value in actual):return None
    result=[];at=0
    for value in expected:
        selected=[];size=0
        while at<len(actual)and size<len(value):
            item,part=actual[at];selected.append(item);size+=len(part);at+=1
        if size!=len(value):return None  # Never divide an unmeasured phoneme interval.
        result.append(selected)
    return result


def spoken_words(text, timings, phonemize, duration):
    words=re.findall(r'\S+',text)
    groups=[];current=[]
    for item in timings:
        if item.phoneme.isspace():
            if current:groups.append(current);current=[]
        else:current.append(item)
    if current:groups.append(current)
    # eSpeak can expand one written unit (20%) into several spoken units. Use
    # the same tokenizer to measure that expansion; never distribute by letters.
    counts=[len(phonemize(word).split()) for word in words]
    if not words or any(count==0 for count in counts):
        raise ValueError('Written words do not map reliably to the spoken phoneme groups. Use clean captions or simplify punctuation.')
    units=None
    if sum(counts)!=len(groups):
        # eSpeak can join adjacent function words, e.g. "with the". Their
        # spaces disappear, but exact per-phoneme model durations remain.
        units=exact_phoneme_units(words,timings,phonemize)
        if units is None:raise ValueError('Written words do not map reliably to the spoken phoneme groups. Use clean captions or simplify punctuation.')
    result=[];at=0
    for word,count in zip(words,counts):
        selected=units[len(result)] if units is not None else [item for group in groups[at:at+count] for item in group]
        sounded=[item for item in selected if item.phoneme not in PUNCTUATION]
        if not sounded:raise ValueError('A written unit has no spoken phonemes.')
        start=max(0,float(sounded[0].start));end=min(duration,float(sounded[-1].end))
        if not 0<=start<end<=duration or result and start<result[-1]['end']-1e-6:
            raise ValueError('The voice model returned unusable word timing.')
        result.append({'text':word,'start':start,'end':end});at+=count
    return result

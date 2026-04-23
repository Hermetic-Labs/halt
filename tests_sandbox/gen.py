import io

_pad = '_'
_punctuation = ';:,.!?¡¿—…"«»“” '
_letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
_letters_ipa = 'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟɠɡɢɣɤɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ'

vocab = _pad + _punctuation + _letters + _letters_ipa

with io.open('c:\\Halt\\rust_inserts.txt', 'w', encoding='utf-8') as f:
    f.write('VALID CHARS STRING:\n')
    f.write(vocab + '\n\n')
    f.write('INSERTS:\n')
    for i, c in enumerate(vocab):
        if c not in ['_', '\'']:
            if c == '\\':
                f.write(f"        m.insert('\\\\', {i});\n")
            elif c == '"':
                f.write(f"        m.insert('\"', {i});\n")
            elif c == ' ':
                f.write(f"        m.insert(' ', {i});\n")
            else:
                f.write(f"        m.insert('{c}', {i});\n")

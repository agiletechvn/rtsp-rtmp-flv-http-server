const logger = require('./logger');
(function () {
  // Utility for Buffer operations
  /*
   * Usage

      Bits = require './bits'

   * Reader
      buf = new Buffer [
        0b11010001
        0b11110000
        0x7f, 0xff, 0xff, 0xff
        0x80, 0x00, 0x00, 0x00
      ]
      myBits = new Bits buf  # A Bits instance holds a cursor
      logger.log myBits.read_bit()
   * => 1
      logger.log myBits.read_bits 2
   * => 2
      myBits.skip_bits 5
      logger.log myBits.read_byte()  # Returns a number
   * => 240
      logger.log myBits.read_bytes 2  # Returns a Buffer instance
   * => <Buffer 7f ff>
      myBits.push_back_bytes 2  # Move the cursor two bytes back
      logger.log myBits.read_int 32
   * => 2147483647
      logger.log myBits.read_int 32
   * => -2147483648

   * Writer
      myBits = new Bits()
      myBits.create_buf()
      myBits.add_bit 1         # 0b1_______
      myBits.add_bits 2, 1     # 0b101_____
      myBits.add_bits 5, 3     # 0b10100011
      myBits.add_bits 8, 0xff  # 0b10100011, 0b11111111
      resultArray = myBits.get_created_buf()  # Returns an array
      resultBuf = new Buffer resultArray
      Bits.printBinary resultBuf
   * => 10100011 11111111 
   */
  var Bits, buffertools, e;

  try {
    buffertools = require('buffertools');
  } catch (error) {
    e = error;
  }

  Bits = function () {
    // buffertools is not available
    class Bits {
      constructor(buffer) {
        this.buf = null;
        this.byte_index = 0;
        this.bit_index = 0;
        this.stash_buf = [];
        this.stash_byte_index = [];
        this.stash_bit_index = [];
        this.c_buf = null;
        this.c_byte_index = 0;
        this.c_bit_index = 0;
        if (buffer != null) {
          this.set_data(buffer);
        }
      }

      static set_warning_fatal(is_fatal) {
        return (Bits.is_warning_fatal = is_fatal);
      }

      create_buf() {
        this.c_buf = [];
        this.c_byte_index = 0;
        return (this.c_bit_index = 0);
      }

      add_bit(value) {
        return this.add_bits(1, value);
      }

      // @param  numBits (int) number of bits to fill with 1
      fill_bits_with_1(numBits) {
        var value;
        if (numBits > 32) {
          throw new Error('numBits must be <= 32');
        }
        value = Math.pow(2, numBits) - 1;
        return this.add_bits(numBits, value);
      }

      // value is up to 32-bit unsigned integer
      add_bits(numBits, value) {
        var available_len, remaining_len, results, this_value;
        if (value > 0xffffffff) {
          throw new Error('value must be <= 0xffffffff (uint32)');
        }
        if (value < 0) {
          throw new Error('value must be >= 0 (uint32)');
        }
        remaining_len = numBits;
        results = [];
        while (remaining_len > 0) {
          if (this.c_buf[this.c_byte_index] == null) {
            this.c_buf[this.c_byte_index] = 0x00; // initialize
          }
          available_len = 8 - this.c_bit_index;
          if (remaining_len <= available_len) {
            // fits into current byte
            this.c_buf[this.c_byte_index] |=
              value << (available_len - remaining_len);
            this.c_bit_index += remaining_len;
            remaining_len = 0;
            if (this.c_bit_index === 8) {
              this.c_byte_index++;
              results.push((this.c_bit_index = 0));
            } else {
              results.push(void 0);
            }
          } else {
            this_value = (value >>> (remaining_len - available_len)) & 0xff;
            this.c_buf[this.c_byte_index] |= this_value;
            remaining_len -= available_len;
            this.c_byte_index++;
            results.push((this.c_bit_index = 0));
          }
        }
        return results;
      }

      // TODO: This method needs a better name, since it returns an array.
      // @return array
      get_created_buf() {
        return this.c_buf;
      }

      current_position() {
        return {
          byte: this.byte_index,
          bit: this.bit_index
        };
      }

      print_position() {
        var remaining_bits;
        remaining_bits = this.get_remaining_bits();
        return logger.log(
          `byteIndex=${this.byte_index + 1} bitIndex=${
            this.bit_index
          } remaining_bits=${remaining_bits}`
        );
      }

      peek() {
        var remainingBits;
        logger.log(this.buf.slice(this.byte_index));
        remainingBits = this.get_remaining_bits();
        return logger.log(
          `bit=${this.bit_index} bytes_read=${
            this.byte_index
          } remaining=${remainingBits} bits (${Math.ceil(
            remainingBits / 8
          )} bytes)`
        );
      }

      skip_bits(len) {
        this.bit_index += len;
        while (this.bit_index >= 8) {
          this.byte_index++;
          this.bit_index -= 8;
        }
      }

      skip_bytes(len) {
        return (this.byte_index += len);
      }

      // Returns the number of skipped bytes
      skip_bytes_equal_to(value) {
        var byte, count;
        count = 0;
        while (true) {
          byte = this.read_byte();
          if (byte !== value) {
            this.push_back_byte();
            return count;
          }
          count++;
        }
      }

      read_uint32() {
        return (
          this.read_byte() * Math.pow(256, 3) +
          (this.read_byte() << 16) +
          (this.read_byte() << 8) +
          this.read_byte()
        );
      }

      // Read a signed number represented by two's complement.
      // bits argument is the length of the signed number including
      // the sign bit.
      read_int(bits) {
        var sign_bit, value;
        if (bits < 0) {
          throw new Error(`read_int: bits argument must be positive: ${bits}`);
        }
        if (bits === 1) {
          return this.read_bit();
        }
        sign_bit = this.read_bit();
        value = this.read_bits(bits - 1);
        if (sign_bit === 1) {
          // negative number
          return -Math.pow(2, bits - 1) + value; // positive number
        } else {
          return value;
        }
      }

      // unsigned integer Exp-Golomb-coded syntax element
      // see clause 9.1
      read_ue() {
        return this.read_exp_golomb();
      }

      // signed integer Exp-Golomb-coded syntax element
      read_se() {
        var value;
        value = this.read_exp_golomb();
        return Math.pow(-1, value + 1) * Math.ceil(value / 2);
      }

      read_exp_golomb() {
        var b, leadingZeroBits;
        leadingZeroBits = -1;
        b = 0;
        while (b === 0) {
          b = this.read_bit();
          leadingZeroBits++;
        }
        return (
          Math.pow(2, leadingZeroBits) - 1 + this.read_bits(leadingZeroBits)
        );
      }

      // Return an instance of Buffer
      read_bytes(len, suppress_boundary_warning = 0) {
        var errmsg, range;
        if (this.bit_index !== 0) {
          throw new Error('read_bytes: bit_index must be 0');
        }
        if (
          !suppress_boundary_warning &&
          this.byte_index + len > this.buf.length
        ) {
          errmsg = `read_bytes exceeded boundary: ${this.byte_index + len} > ${
            this.buf.length
          }`;
          if (Bits.is_warning_fatal) {
            throw new Error(errmsg);
          } else {
            logger.log(`warning: bits.read_bytes: ${errmsg}`);
          }
        }
        range = this.buf.slice(this.byte_index, this.byte_index + len);
        this.byte_index += len;
        return range;
      }

      read_bytes_sum(len) {
        var i, j, ref, sum;
        sum = 0;
        for (
          i = j = ref = len;
          ref <= 0 ? j < 0 : j > 0;
          i = ref <= 0 ? ++j : --j
        ) {
          sum += this.read_byte();
        }
        return sum;
      }

      read_byte() {
        var value;
        if (this.bit_index === 0) {
          if (this.byte_index < this.buf.length) {
            value = this.buf[this.byte_index++];
          } else {
            // throw new Error("read_byte error: no more data");
          }
        } else {
          value = this.read_bits(8);
        }
        return value;
      }

      read_bits(len) {
        var bit_buf, i, j, ref;
        if (len === 0) {
          return 0;
        }
        bit_buf = '';
        for (
          i = j = 0, ref = len;
          0 <= ref ? j < ref : j > ref;
          i = 0 <= ref ? ++j : --j
        ) {
          bit_buf += this.read_bit().toString();
        }
        return parseInt(bit_buf, 2);
      }

      read_bit() {
        var value;
        if (this.byte_index >= this.buf.length) {
          throw new Error('read_bit error: no more data');
        }
        value = this.bit(this.bit_index++, this.buf[this.byte_index]);
        if (this.bit_index === 8) {
          this.byte_index++;
          this.bit_index = 0;
        }
        return value;
      }

      push_back_byte() {
        return this.push_back_bytes(1);
      }

      push_back_bytes(len) {
        return this.push_back_bits(len * 8);
      }

      push_back_bits(len) {
        while (len-- > 0) {
          this.bit_index--;
          if (this.bit_index === -1) {
            this.bit_index = 7;
            this.byte_index--;
          }
        }
      }

      bit(index, byte) {
        var idx, j, len1, result;
        result = null;
        if (index instanceof Array) {
          result = [];
          for (j = 0, len1 = result.length; j < len1; j++) {
            idx = result[j];
            result.push((byte >> (7 - idx)) & 0x01);
          }
        } else {
          result = (byte >> (7 - index)) & 0x01;
        }
        return result;
      }

      push_stash() {
        this.stash_buf.push(this.buf);
        this.stash_byte_index.push(this.byte_index);
        return this.stash_bit_index.push(this.bit_index);
      }

      pop_stash() {
        this.buf = this.stash_buf.pop();
        this.byte_index = this.stash_byte_index.pop();
        return (this.bit_index = this.stash_bit_index.pop());
      }

      set_data(bytes) {
        this.buf = bytes;
        this.byte_index = 0;
        return (this.bit_index = 0);
      }

      has_more_data() {
        return this.get_remaining_bits() > 0;
      }

      get_remaining_bits() {
        var total_bits, total_read_bits;
        total_bits = this.buf.length * 8;
        total_read_bits = this.byte_index * 8 + this.bit_index;
        return total_bits - total_read_bits;
      }

      get_remaining_bytes() {
        var remainingLen;
        if (this.bit_index !== 0) {
          console.warn('warning: bits.get_remaining_bytes: bit_index is not 0');
        }
        remainingLen = this.buf.length - this.byte_index;
        if (remainingLen < 0) {
          remainingLen = 0;
        }
        return remainingLen;
      }

      remaining_buffer() {
        if (this.bit_index !== 0) {
          console.warn('warning: bits.remaining_buffer: bit_index is not 0');
        }
        return this.buf.slice(this.byte_index);
      }

      is_byte_aligned() {
        return this.bit_index === 0;
      }

      read_until_byte_aligned() {
        var sum;
        sum = 0;
        while (this.bit_index !== 0) {
          sum += this.read_bit();
        }
        return sum;
      }

      // @param bitVal (number)  0 or 1

      // @return object or null  If rbsp_stop_one_bit is found,
      // returns an object {
      //   byte: (number) byte index (starts from 0)
      //   bit : (number) bit index (starts from 0)
      // }. If it is not found, returns null.
      lastIndexOfBit(bitVal) {
        var byte, col, i, j, k, ref, ref1;
        for (
          i = j = ref = this.buf.length - 1, ref1 = this.byte_index;
          ref <= ref1 ? j <= ref1 : j >= ref1;
          i = ref <= ref1 ? ++j : --j
        ) {
          byte = this.buf[i];
          if (
            (bitVal === 1 && byte !== 0x00) ||
            (bitVal === 0 && byte !== 0xff)
          ) {
            // this byte contains the target bit
            for (col = k = 0; k <= 7; col = ++k) {
              if (((byte >> col) & 0x01) === bitVal) {
                return {
                  byte: i,
                  bit: 7 - col
                };
              }
              if (i === this.byte_index && 7 - col === this.bit_index) {
                return null;
              }
            }
          }
        }
        return null; // not found
      }

      get_current_byte() {
        return this.get_byte_at(0);
      }

      get_byte_at(byteOffset) {
        if (this.bit_index === 0) {
          return this.buf[this.byte_index + byteOffset];
        } else {
          return Bits.parse_bits_uint(this.buf, byteOffset * 8, 8);
        }
      }

      last_get_byte_at(offsetFromEnd) {
        var offsetFromStart;
        offsetFromStart = this.buf.length - 1 - offsetFromEnd;
        if (offsetFromStart < 0) {
          throw new Error('error: last_get_byte_at: index out of range');
        }
        return this.buf[offsetFromStart];
      }

      remove_trailing_bytes(numBytes) {
        if (this.buf.length < numBytes) {
          console.warn(
            `warning: bits.remove_trailing_bytes: Buffer length (${this.buf.length}) is less than numBytes (${numBytes})`
          );
          this.buf = Buffer.from([]);
        } else {
          this.buf = this.buf.slice(0, this.buf.length - numBytes);
        }
      }

      mark() {
        if (this.marks == null) {
          return (this.marks = [this.byte_index]);
        } else {
          return this.marks.push(this.byte_index);
        }
      }

      marked_bytes() {
        var startIndex;
        if (this.marks == null || this.marks.length === 0) {
          throw new Error('The buffer has not been marked');
        }
        startIndex = this.marks.pop();
        return this.buf.slice(startIndex, +(this.byte_index - 1) + 1 || 9e9);
      }

      // Returns a null-terminated string
      get_string(encoding = 'utf8') {
        var nullPos, str;
        nullPos = Bits.searchByteInBuffer(this.buf, 0x00, this.byte_index);
        if (nullPos === -1) {
          // logger.log(this.buf.toString());
          // throw new Error("bits.get_string: the string is not null-terminated");
          logger.warn('bits.get_string: the string is not null-terminated');
          return str;
        }
        str = this.buf.slice(this.byte_index, nullPos).toString(encoding);
        this.byte_index = nullPos + 1;
        return str;
      }

      // Returns a string constructed by a number
      static uintToString(num, numBytes, encoding = 'utf8') {
        var arr, i, j, ref;
        arr = [];
        for (
          i = j = ref = numBytes;
          ref <= 1 ? j <= 1 : j >= 1;
          i = ref <= 1 ? ++j : --j
        ) {
          arr.push((num * Math.pow(2, -(i - 1) * 8)) & 0xff);
        }
        return Buffer.from(arr).toString(encoding);
      }

      // Returns the first index at which a given value (byte) can be
      // found in the Buffer (buf), or -1 if it is not found.
      static searchByteInBuffer(buf, byte, from_pos = 0) {
        var i, j, ref, ref1;
        if (!Bits.DISABLE_BUFFER_INDEXOF && typeof buf.indexOf === 'function') {
          return buf.indexOf(byte, from_pos);
        } else {
          if (from_pos < 0) {
            from_pos = buf.length + from_pos;
          }
          for (
            i = j = ref = from_pos, ref1 = buf.length;
            ref <= ref1 ? j < ref1 : j > ref1;
            i = ref <= ref1 ? ++j : --j
          ) {
            if (buf[i] === byte) {
              return i;
            }
          }
          return -1;
        }
      }

      static searchBytesInArray(haystack, needle, from_pos = 0) {
        var haystack_idx, haystack_len, needle_idx, needle_len;
        if (buffertools != null) {
          if (!(haystack instanceof Buffer)) {
            haystack = Buffer.from(haystack);
          }
          if (!(needle instanceof Buffer)) {
            needle = Buffer.from(needle);
          }
          return buffertools.indexOf(haystack, needle, from_pos); // buffertools is not available
        } else {
          haystack_len = haystack.length;
          if (from_pos >= haystack_len) {
            return -1;
          }
          needle_idx = 0;
          needle_len = needle.length;
          haystack_idx = from_pos;
          while (true) {
            if (haystack[haystack_idx] === needle[needle_idx]) {
              needle_idx++;
              if (needle_idx === needle_len) {
                return haystack_idx - needle_len + 1;
              }
            } else if (needle_idx > 0) {
              haystack_idx -= needle_idx;
              needle_idx = 0;
            }
            haystack_idx++;
            if (haystack_idx === haystack_len) {
              return -1;
            }
          } // buffertools is available
        }
      }

      static searchBitsInArray(haystack, needle, fromPos = 0) {
        var haystackIdx, haystackLen, needleIdx;
        if (fromPos >= haystack.length) {
          return -1;
        }
        needleIdx = 0;
        haystackIdx = fromPos;
        haystackLen = haystack.length;
        while (true) {
          if (
            (haystack[haystackIdx] & needle[needleIdx]) ===
            needle[needleIdx]
          ) {
            needleIdx++;
            if (needleIdx === needle.length) {
              return haystackIdx - needle.length + 1;
            }
          } else {
            if (needleIdx > 0) {
              haystackIdx -= needleIdx;
              needleIdx = 0;
            }
          }
          haystackIdx++;
          if (haystackIdx === haystackLen) {
            return -1;
          }
        }
      }

      // Read <len> bits from the bit position <pos> from the start of
      // the buffer <buf>, and return it as unsigned integer
      static parse_bits_uint(buffer, pos, len) {
        var bitIndex, byteIndex, consumedLen, num, otherBitsLen;
        byteIndex = parseInt(pos / 8);
        bitIndex = pos % 8;
        consumedLen = 0;
        num = 0;
        while (consumedLen < len) {
          consumedLen += 8 - bitIndex;
          otherBitsLen = 0;
          if (consumedLen > len) {
            otherBitsLen = consumedLen - len;
            consumedLen = len;
          }
          num +=
            ((buffer[byteIndex] & ((1 << (8 - bitIndex)) - 1)) <<
              (len - consumedLen)) >>
            otherBitsLen;
          byteIndex++;
          bitIndex = 0;
        }
        return num;
      }

      static toBinary(byte) {
        var binString, i, j;
        binString = '';
        for (i = j = 7; j >= 0; i = --j) {
          binString += (byte >> i) & 0x01;
        }
        return binString;
      }

      static printBinary(buffer) {
        var byte, col, j, len1;
        col = 0;
        for (j = 0, len1 = buffer.length; j < len1; j++) {
          byte = buffer[j];
          process.stdout.write(Bits.toBinary(byte));
          col++;
          if (col === 4) {
            logger.log();
            col = 0;
          } else {
            process.stdout.write(' ');
          }
        }
        if (col !== 0) {
          return logger.log();
        }
      }

      static getHexdump(buffer) {
        var byte, col, dump, endline, j, len1, strline;
        col = 0;
        strline = '';
        dump = '';
        endline = function () {
          var pad;
          pad = '  ';
          while (col < 16) {
            pad += '  ';
            if (col % 2 === 0) {
              pad += ' ';
            }
            col++;
          }
          dump += pad + strline + '\n';
          return (strline = '');
        };
        for (j = 0, len1 = buffer.length; j < len1; j++) {
          byte = buffer[j];
          if (0x20 <= byte && byte <= 0x7e) {
            // printable char
            strline += String.fromCharCode(byte);
          } else {
            strline += ' ';
          }
          dump += Bits.zeropad(2, byte.toString(16));
          col++;
          if (col === 16) {
            endline();
            col = 0;
          } else if (col % 2 === 0) {
            dump += ' ';
          }
        }
        if (col !== 0) {
          endline();
        }
        return dump;
      }

      static hexdump(buffer) {
        return process.stdout.write(Bits.getHexdump(buffer));
      }

      static zeropad(width, num) {
        num += '';
        while (num.length < width) {
          num = '0' + num;
        }
        return num;
      }
    }

    Bits.DISABLE_BUFFER_INDEXOF = false;

    return Bits;
  }.call(this);

  module.exports = Bits;
}.call(this));

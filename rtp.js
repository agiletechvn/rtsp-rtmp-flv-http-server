// Generated by CoffeeScript 2.5.1
(function() {
  // RTP spec:
  //   RFC 3550  http://tools.ietf.org/html/rfc3550
  // RTP payload format for H.264 video:
  //   RFC 6184  http://tools.ietf.org/html/rfc6184
  // RTP payload format for AAC audio:
  //   RFC 3640  http://tools.ietf.org/html/rfc3640
  //   RFC 5691  http://tools.ietf.org/html/rfc5691

  // TODO: Use DON (decoding order number) to carry B-frames.
  //       DON is to RTP what DTS is to MPEG-TS.
  var Bits,
    EPOCH,
    MAX_PAYLOAD_SIZE,
    MAX_SEQUENCE_NUMBER,
    NTP_SCALE_FRAC,
    RTPParser,
    RTP_HEADER_LEN,
    aac,
    api,
    logger;

  Bits = require("./bits");

  aac = require("./aac");

  logger = require("./logger");

  // Number of seconds from 1900-01-01 to 1970-01-01
  EPOCH = 2208988800;

  // Constant for calculating NTP fractional second
  NTP_SCALE_FRAC = 4294.967295;

  // Minimum length of an RTP header
  RTP_HEADER_LEN = 12;

  MAX_PAYLOAD_SIZE = 1360;

  MAX_SEQUENCE_NUMBER = 65535;

  RTPParser = class RTPParser {
    constructor() {
      this.eventListeners = {};
      this.packetBuffers = {};
      this.fragmentedH264PacketBuffer = {};
      this.h264NALUnitBuffer = {};
      this.aacAccessUnitBuffer = {};
      // config
      this.unorderedPacketBufferSize = 10;
    }

    emit(name, ...data) {
      var j, len, listener, ref;
      if (this.eventListeners[name] != null) {
        ref = this.eventListeners[name];
        for (j = 0, len = ref.length; j < len; j++) {
          listener = ref[j];
          listener(...data);
        }
      }
    }

    on(name, listener) {
      if (this.eventListeners[name] != null) {
        return this.eventListeners[name].push(listener);
      } else {
        return (this.eventListeners[name] = [listener]);
      }
    }

    feedUnorderedAACBuffer(buf, clientId, params) {
      var packet;
      packet = api.parseAACPacket(buf, params);
      return this.feedUnorderedPacket(`aac:${clientId}`, packet);
    }

    feedUnorderedH264Buffer(buf, clientId) {
      var packet;
      packet = api.parseH264Packet(buf);
      return this.feedUnorderedPacket(`h264:${clientId}`, packet);
    }

    clearAllUnorderedPacketBuffers() {
      return (this.packetBuffers = {});
    }

    clearUnorderedPacketBuffer(tag) {
      delete this.packetBuffers[`h264:${tag}`];
      return delete this.packetBuffers[`aac:${tag}`];
    }

    feedUnorderedPacket(tag, packet) {
      var buffers,
        diff,
        discardedSequenceNumber,
        firstPacket,
        latestSequenceNumber,
        packetBuffer,
        results;
      if (this.packetBuffers[tag] == null) {
        this.packetBuffers[tag] = {
          nextSequenceNumber: packet.rtpHeader.sequenceNumber,
          minSequenceNumberInBuffer: null,
          buffer: []
        };
      }
      packetBuffer = this.packetBuffers[tag];
      if (packetBuffer.nextSequenceNumber === packet.rtpHeader.sequenceNumber) {
        this.onOrderedPacket(tag, packet);
        packetBuffer.nextSequenceNumber++;
        if (packetBuffer.nextSequenceNumber > MAX_SEQUENCE_NUMBER) {
          return (packetBuffer.nextSequenceNumber = 0);
        }
      } else {
        // stash packet in buffer
        buffers = packetBuffer.buffer;
        buffers.push(packet);
        if (buffers.length >= 2) {
          buffers.sort(function(a, b) {
            var numberA, numberB;
            numberA = a.rtpHeader.sequenceNumber;
            numberB = b.rtpHeader.sequenceNumber;
            if (numberA - numberB >= 60000) {
              // large enough gap
              return -1; // a comes first
            } else if (numberB - numberA >= 60000) {
              // large enough gap
              return 1; // b comes first
            } else {
              return numberA - numberB;
            }
          });
          while (
            buffers.length > 0 &&
            buffers[0].rtpHeader.sequenceNumber ===
              packetBuffer.nextSequenceNumber
          ) {
            this.onOrderedPacket(tag, buffers.shift());
            packetBuffer.nextSequenceNumber++;
            if (packetBuffer.nextSequenceNumber > MAX_SEQUENCE_NUMBER) {
              packetBuffer.nextSequenceNumber = 0;
            }
          }
          results = [];
          while (buffers.length >= 2) {
            latestSequenceNumber =
              buffers[buffers.length - 1].rtpHeader.sequenceNumber;
            diff = latestSequenceNumber - packetBuffer.nextSequenceNumber;
            if (diff < 0) {
              diff += MAX_SEQUENCE_NUMBER + 1;
            }
            if (diff < this.unorderedPacketBufferSize) {
              break;
            }
            firstPacket = buffers.shift();
            if (
              packetBuffer.nextSequenceNumber !==
              firstPacket.rtpHeader.sequenceNumber
            ) {
              discardedSequenceNumber =
                firstPacket.rtpHeader.sequenceNumber - 1;
              if (discardedSequenceNumber < 0) {
                discardedSequenceNumber += MAX_SEQUENCE_NUMBER;
              }
              if (packetBuffer.nextSequenceNumber !== discardedSequenceNumber) {
                logger.warn(
                  `rtp: ${tag}: incoming packet loss: sequence number ${packetBuffer.nextSequenceNumber}-${discardedSequenceNumber}`
                );
              } else {
                logger.warn(
                  `rtp: ${tag}: incoming packet loss: sequence number ${discardedSequenceNumber}`
                );
              }
            }
            // consume the first packet
            this.onOrderedPacket(tag, firstPacket);
            packetBuffer.nextSequenceNumber =
              firstPacket.rtpHeader.sequenceNumber + 1;
            if (packetBuffer.nextSequenceNumber > MAX_SEQUENCE_NUMBER) {
              results.push((packetBuffer.nextSequenceNumber = 0));
            } else {
              results.push(void 0);
            }
          }
          return results;
        }
      }
    }

    onH264NALUnit(clientId, nalUnit, packet, timestamp) {
      if (this.h264NALUnitBuffer[clientId] == null) {
        this.h264NALUnitBuffer[clientId] = [];
      }
      this.h264NALUnitBuffer[clientId].push(nalUnit);
      if (packet.rtpHeader.marker) {
        this.emit(
          "h264_nal_units",
          clientId,
          this.h264NALUnitBuffer[clientId],
          timestamp
        );
        return (this.h264NALUnitBuffer[clientId] = []);
      }
    }

    onAACAccessUnits(clientId, accessUnits, packet, timestamp) {
      if (this.aacAccessUnitBuffer[clientId] == null) {
        this.aacAccessUnitBuffer[clientId] = [];
      }
      this.aacAccessUnitBuffer[clientId] = this.aacAccessUnitBuffer[
        clientId
      ].concat(accessUnits);
      if (packet.rtpHeader.marker) {
        this.emit(
          "aac_access_units",
          clientId,
          this.aacAccessUnitBuffer[clientId],
          timestamp
        );
        return (this.aacAccessUnitBuffer[clientId] = []);
      }
    }

    onOrderedPacket(tag, packet) {
      var clientId, j, len, match, nalUnit, ref, results;
      if ((match = /^h264:(.*)$/.exec(tag)) != null) {
        clientId = match[1];
        if (packet.h264.fu_a != null) {
          // startBit and endBit won't both be set to 1 in the same FU header
          if (packet.h264.fu_a.fuHeader.startBit) {
            this.fragmentedH264PacketBuffer[tag] = [
              Buffer.from([
                (packet.h264.nal_ref_idc << 5) |
                  packet.h264.fu_a.fuHeader.nal_unit_payload_type
              ]),
              packet.h264.fu_a.nal_unit_fragment
            ];
          } else if (this.fragmentedH264PacketBuffer[tag] != null) {
            this.fragmentedH264PacketBuffer[tag].push(
              packet.h264.fu_a.nal_unit_fragment
            );
          } else {
            logger.warn(
              `rtp: ${tag}: discarded fragmented incoming packet: ${packet.rtpHeader.sequenceNumber}`
            );
            return;
          }
          if (packet.h264.fu_a.fuHeader.endBit) {
            this.onH264NALUnit(
              clientId,
              Buffer.concat(this.fragmentedH264PacketBuffer[tag]),
              packet,
              packet.rtpHeader.timestamp
            );
            return (this.fragmentedH264PacketBuffer[tag] = null);
          }
        } else if (packet.h264.stap_a != null) {
          ref = packet.h264.stap_a.nalUnits;
          results = [];
          for (j = 0, len = ref.length; j < len; j++) {
            nalUnit = ref[j];
            results.push(
              this.onH264NALUnit(
                clientId,
                nalUnit,
                packet,
                packet.rtpHeader.timestamp
              )
            ); // single NAL unit
          }
          return results;
        } else {
          return this.onH264NALUnit(
            clientId,
            packet.h264.nal_unit,
            packet,
            packet.rtpHeader.timestamp
          ); // STAP-A
          // FU-A
        }
      } else if ((match = /^aac:(.*)$/.exec(tag)) != null) {
        clientId = match[1];
        return this.onAACAccessUnits(
          clientId,
          packet.aac.accessUnits,
          packet,
          packet.rtpHeader.timestamp
        );
      } else {
        throw new Error(`Unknown tag: ${tag}`);
      }
    }
  };

  api = {
    RTPParser: RTPParser,
    // Number of bytes in RTP header
    RTP_HEADER_LEN: RTP_HEADER_LEN,
    RTCP_PACKET_TYPE_SENDER_REPORT: 200, // SR
    RTCP_PACKET_TYPE_RECEIVER_REPORT: 201, // RR
    RTCP_PACKET_TYPE_SOURCE_DESCRIPTION: 202, // SDES
    RTCP_PACKET_TYPE_GOODBYE: 203, // BYE
    RTCP_PACKET_TYPE_APPLICATION_DEFINED: 204, // APP
    H264_NAL_UNIT_TYPE_STAP_A: 24,
    H264_NAL_UNIT_TYPE_STAP_B: 25,
    H264_NAL_UNIT_TYPE_MTAP16: 26,
    H264_NAL_UNIT_TYPE_MTAP24: 27,
    H264_NAL_UNIT_TYPE_FU_A: 28,
    H264_NAL_UNIT_TYPE_FU_B: 29,
    // Remove padding from the end of the buffer
    removeTrailingPadding: function(bits) {
      var paddingLength;
      paddingLength = bits.last_get_byte_at(0);
      return bits.remove_trailing_bytes(paddingLength);
    },
    readRTCPSenderReport: function(bits) {
      var i, info, j, readBytes, ref, reportBlock, startBytePos;
      // RFC 3550 - 6.4.1 SR: Sender Report RTCP Packet
      startBytePos = bits.current_position().byte;
      info = {};
      info.version = bits.read_bits(2);
      info.padding = bits.read_bit();
      if (info.padding === 1) {
        api.removeTrailingPadding(bits);
      }
      info.reportCount = bits.read_bits(5);
      info.payloadType = bits.read_byte(); // == 200
      if (info.payloadType !== api.RTCP_PACKET_TYPE_SENDER_REPORT) {
        throw new Error(
          `payload type must be ${api.RTCP_PACKET_TYPE_SENDER_REPORT}`
        );
      }
      info.wordsMinusOne = bits.read_bits(16);
      info.totalBytes = (info.wordsMinusOne + 1) * 4;
      info.ssrc = bits.read_bits(32);
      info.ntpTimestamp = [bits.read_bits(32), bits.read_bits(32)];
      info.ntpTimestampInMs = api.ntpTimestampToTime(info.ntpTimestamp);
      info.rtpTimestamp = bits.read_bits(32);
      info.senderPacketCount = bits.read_bits(32);
      info.senderOctetCount = bits.read_bits(32);
      info.reportBlocks = [];
      for (
        i = j = 0, ref = info.reportCount;
        0 <= ref ? j < ref : j > ref;
        i = 0 <= ref ? ++j : --j
      ) {
        reportBlock = {};
        reportBlock.ssrc = bits.read_bits(32);
        reportBlock.fractionLost = bits.read_byte();
        reportBlock.packetsLost = bits.read_int(24);
        reportBlock.highestSequenceNumber = bits.read_bits(32);
        reportBlock.jitter = bits.read_bits(32);
        reportBlock.lastSR = bits.read_bits(32);
        reportBlock.delaySinceLastSR = bits.read_bits(32);
        info.reportBlocks.push(reportBlock);
      }
      // skip padding bytes
      readBytes = bits.current_position().byte - startBytePos;
      if (readBytes < info.totalBytes) {
        bits.skip_bytes(info.totalBytes - readBytes);
      }
      return info;
    },
    readRTCPReceiverReport: function(bits) {
      var i, info, j, readBytes, ref, reportBlock, startBytePos;
      // RFC 3550 - 6.4.2 RR: Receiver Report RTCP Packet
      startBytePos = bits.current_position().byte;
      info = {};
      info.version = bits.read_bits(2);
      info.padding = bits.read_bit();
      if (info.padding === 1) {
        api.removeTrailingPadding(bits);
      }
      info.reportCount = bits.read_bits(5);
      info.payloadType = bits.read_byte(); // == 201
      if (info.payloadType !== api.RTCP_PACKET_TYPE_RECEIVER_REPORT) {
        throw new Error(
          `payload type must be ${api.RTCP_PACKET_TYPE_RECEIVER_REPORT}`
        );
      }
      info.wordsMinusOne = bits.read_bits(16);
      info.totalBytes = (info.wordsMinusOne + 1) * 4;
      info.ssrc = bits.read_bits(32);
      info.reportBlocks = [];
      for (
        i = j = 0, ref = info.reportCount;
        0 <= ref ? j < ref : j > ref;
        i = 0 <= ref ? ++j : --j
      ) {
        reportBlock = {};
        reportBlock.ssrc = bits.read_bits(32);
        reportBlock.fractionLost = bits.read_byte();
        reportBlock.packetsLost = bits.read_int(24);
        reportBlock.highestSequenceNumber = bits.read_bits(32);
        reportBlock.jitter = bits.read_bits(32);
        reportBlock.lastSR = bits.read_bits(32);
        reportBlock.delaySinceLastSR = bits.read_bits(32);
        info.reportBlocks.push(reportBlock);
      }
      // skip padding bytes
      readBytes = bits.current_position().byte - startBytePos;
      if (readBytes < info.totalBytes) {
        bits.skip_bytes(info.totalBytes - readBytes);
      }
      return info;
    },
    readRTCPSourceDescription: function(bits) {
      var bytesPastBoundary,
        chunk,
        i,
        info,
        j,
        nullOctet,
        readBytes,
        ref,
        sdesItem,
        startBytePos;
      // RFC 3550 - 6.5 SDES: Source Description RTCP Packet
      startBytePos = bits.current_position().byte;
      info = {};
      info.version = bits.read_bits(2);
      info.padding = bits.read_bit();
      if (info.padding === 1) {
        api.removeTrailingPadding(bits);
      }
      info.sourceCount = bits.read_bits(5);
      info.payloadType = bits.read_byte(); // == 202
      if (info.payloadType !== api.RTCP_PACKET_TYPE_SOURCE_DESCRIPTION) {
        throw new Error(
          `payload type must be ${api.RTCP_PACKET_TYPE_SOURCE_DESCRIPTION}`
        );
      }
      info.wordsMinusOne = bits.read_bits(16);
      info.totalBytes = (info.wordsMinusOne + 1) * 4;
      info.chunks = [];
      for (
        i = j = 0, ref = info.sourceCount;
        0 <= ref ? j < ref : j > ref;
        i = 0 <= ref ? ++j : --j
      ) {
        chunk = {};
        chunk.ssrc_csrc = bits.read_bits(32);
        chunk.sdesItems = [];
        chunk.sdes = {};
        while (true) {
          sdesItem = {};
          sdesItem.type = bits.read_byte();
          if (sdesItem.type === 0) {
            // terminate the list
            // skip until the next 32-bit boundary
            bytesPastBoundary =
              (bits.current_position().byte - startBytePos) % 4;
            if (bytesPastBoundary > 0) {
              while (bytesPastBoundary < 4) {
                nullOctet = bits.read_byte();
                if (nullOctet !== 0x00) {
                  throw new Error(`padding octet must be 0x00: ${nullOctet}`);
                }
                bytesPastBoundary++;
              }
            }
            break;
          }
          sdesItem.octetCount = bits.read_byte();
          if (sdesItem.octetCount > 255) {
            throw new Error(
              `octet count too large: ${sdesItem.octetCount} <= 255`
            );
          }
          sdesItem.text = bits.read_bytes(sdesItem.octetCount).toString("utf8");
          switch (sdesItem.type) {
            case 1: // Canonical End-Point Identifier
              chunk.sdes.cname = sdesItem.text;
              break;
            case 2: // User Name
              chunk.sdes.name = sdesItem.text;
              break;
            case 3: // Electronic Mail Address
              chunk.sdes.email = sdesItem.text;
              break;
            case 4: // Phone Number
              chunk.sdes.phone = sdesItem.text;
              break;
            case 5: // Geographic User Location
              chunk.sdes.loc = sdesItem.text;
              break;
            case 6: // Application or Tool Name
              chunk.sdes.tool = sdesItem.text;
              break;
            case 7: // Notice/Status
              chunk.sdes.note = sdesItem.text;
              break;
            case 8: // Private Extensions
              chunk.sdes.priv = sdesItem.text;
              break;
            default:
              throw new Error(
                "unknown SDES item type in source description " +
                  `RTCP packet: ${chunk.type} (maybe not implemented yet)`
              );
          }
          chunk.sdesItems.push(sdesItem);
        }
        info.chunks.push(chunk);
      }
      // skip padding bytes
      readBytes = bits.current_position().byte - startBytePos;
      if (readBytes < info.totalBytes) {
        bits.skip_bytes(info.totalBytes - readBytes);
      }
      return info;
    },
    readRTCPGoodbye: function(bits) {
      var info, readBytes, reason, startBytePos;
      // RFC 3550 - 6.6 BYE: Goodbye RTCP Packet
      startBytePos = bits.current_position().byte;
      info = {};
      info.version = bits.read_bits(2);
      info.padding = bits.read_bit();
      if (info.padding === 1) {
        api.removeTrailingPadding(bits);
      }
      info.sourceCount = bits.read_bits(5);
      info.payloadType = bits.read_byte(); // == 203
      if (info.payloadType !== api.RTCP_PACKET_TYPE_GOODBYE) {
        throw new Error(`payload type must be ${api.RTCP_PACKET_TYPE_GOODBYE}`);
      }
      info.wordsMinusOne = bits.read_bits(16);
      info.totalBytes = (info.wordsMinusOne + 1) * 4;
      info.ssrc = bits.read_bits(32);
      if (bits.has_more_data()) {
        info.reasonOctetCount = bits.read_byte();
        reason = bits.read_bytes(info.reasonOctetCount);
      }
      // skip padding bytes
      readBytes = bits.current_position().byte - startBytePos;
      if (readBytes < info.totalBytes) {
        bits.skip_bytes(info.totalBytes - readBytes);
      }
      return info;
    },
    readRTCPApplicationDefined: function(bits) {
      var info, readBytes, startBytePos;
      // RFC 3550 - 6.7 APP: Application-Defined RTCP Packet
      startBytePos = bits.current_position().byte;
      info = {};
      info.version = bits.read_bits(2);
      info.padding = bits.read_bit();
      if (info.padding === 1) {
        api.removeTrailingPadding(bits);
      }
      info.subtype = bits.read_bits(5);
      info.payloadType = bits.read_byte(); // == 204
      if (info.payloadType !== api.RTCP_PACKET_TYPE_APPLICATION_DEFINED) {
        throw new Error(
          `payload type must be ${api.RTCP_PACKET_TYPE_APPLICATION_DEFINED}`
        );
      }
      info.wordsMinusOne = bits.read_bits(16);
      info.totalBytes = (info.wordsMinusOne + 1) * 4;
      info.ssrc_csrc = bits.read_bits(32);
      info.name = bits.read_bytes(4).toString("ascii");
      // read the application-dependent data (remaining bytes)
      readBytes = bits.current_position().byte - startBytePos;
      if (readBytes < info.totalBytes) {
        info.applicationData = bits.read_bytes(info.totalBytes - readBytes);
      } else {
        info.applicationData = null;
      }
      return info;
    },
    readRTPFixedHeader: function(bits) {
      var i, info, j, ref;
      // RFC 3550 - 5.1 RTP Fixed Header Fields
      info = {};
      info.version = bits.read_bits(2);
      info.padding = bits.read_bit();
      if (info.padding === 1) {
        api.removeTrailingPadding(bits);
      }
      info.extension = bits.read_bit();
      info.csrcCount = bits.read_bits(4);
      info.marker = bits.read_bit();
      info.payloadType = bits.read_bits(7);
      info.sequenceNumber = bits.read_bits(16);
      info.timestamp = bits.read_bits(32);
      info.ssrc = bits.read_bits(32);
      info.csrc = [];
      for (
        i = j = 0, ref = info.csrcCount;
        0 <= ref ? j < ref : j > ref;
        i = 0 <= ref ? ++j : --j
      ) {
        info.csrc.push(bits.read_bits(32));
      }
      return info;
    },
    parseAACPacket: function(buf, params) {
      var bits, packet;
      bits = new Bits(buf);
      packet = {};
      packet.rtpHeader = api.readRTPFixedHeader(bits);
      packet.aac = api.readAACPayload(bits, params);
      return packet;
    },
    parseH264Packet: function(buf) {
      var bits, packet;
      bits = new Bits(buf);
      packet = {};
      packet.rtpHeader = api.readRTPFixedHeader(bits);
      packet.h264 = api.readH264Payload(bits);
      return packet;
    },
    readH264Payload: function(bits) {
      var info, ref, ref1;
      info = {};
      info.forbidden_zero_bit = bits.read_bit(); // 1 indicates error
      if (info.forbidden_zero_bit !== 0) {
        throw new Error(
          `forbidden_zero_bit must be 0 (got ${info.forbidden_zero_bit})`
        );
      }
      info.nal_ref_idc = bits.read_bits(2); // == 00: not important, > 00: important
      info.nal_unit_type = bits.read_bits(5);
      if (1 <= (ref = info.nal_unit_type) && ref <= 23) {
        // Single NAL unit packet
        bits.push_back_byte();
        info.nal_unit = bits.remaining_buffer();
      } else if (24 <= (ref1 = info.nal_unit_type) && ref1 <= 29) {
        switch (info.nal_unit_type) {
          case api.H264_NAL_UNIT_TYPE_STAP_A: // STAP-A (24)
            info.stap_a = api.readH264STAP_A(bits);
            break;
          case api.H264_NAL_UNIT_TYPE_FU_A: // FU-A (28)
            info.fu_a = api.readH264FragmentationUnitA(bits);
            break;
          default:
            throw new Error(
              `Not implemented: nal_unit_type=${info.nal_unit_type} (please report this bug)`
            );
        }
      } else {
        throw new Error(`Invalid nal_unit_type=${info.nal_unit_type}`);
      }
      return info;
    },
    // Read Single-Time Aggregation Packet type A (STAP-A)
    readH264STAP_A: function(bits) {
      var info, nalUnitSize;
      info = {
        nalUnits: []
      };
      while (bits.get_remaining_bytes() >= 2) {
        nalUnitSize = bits.read_bits(16);
        info.nalUnits.push(bits.read_bytes(nalUnitSize));
      }
      if (info.nalUnits.length < 1) {
        logger.error("rtp: error: STAP-A does not contain a NAL unit");
      }
      return info;
    },
    readH264FragmentationUnitA: function(bits) {
      var info;
      info = {};
      info.fuHeader = api.readH264FragmentationUnitHeader(bits);
      info.nal_unit_fragment = bits.remaining_buffer();
      return info;
    },
    // FU header
    readH264FragmentationUnitHeader: function(bits) {
      var info, reservedBit;
      info = {};
      info.startBit = bits.read_bit();
      info.endBit = bits.read_bit();
      reservedBit = bits.read_bit();
      if (reservedBit !== 0) {
        throw new Error(`reserved bit must be 0 (got ${reservedBit})`);
      }
      info.nal_unit_payload_type = bits.read_bits(5);
      return info;
    },
    parsePacket: function(buf) {
      var bits, packet, payloadValue;
      bits = new Bits(buf);
      packet = {};
      payloadValue = bits.get_byte_at(1); // including marker bit
      switch (payloadValue) {
        case api.RTCP_PACKET_TYPE_SENDER_REPORT:
          packet.rtcpSenderReport = api.readRTCPSenderReport(bits);
          break;
        case api.RTCP_PACKET_TYPE_RECEIVER_REPORT:
          packet.rtcpReceiverReport = api.readRTCPReceiverReport(bits);
          break;
        case api.RTCP_PACKET_TYPE_SOURCE_DESCRIPTION:
          packet.rtcpSourceDescription = api.readRTCPSourceDescription(bits);
          break;
        case api.RTCP_PACKET_TYPE_GOODBYE:
          packet.rtcpGoodbye = api.readRTCPGoodbye(bits);
          break;
        case api.RTCP_PACKET_TYPE_APPLICATION_DEFINED:
          packet.rtcpApplicationDefined = api.readRTCPApplicationDefined(bits); // RTP data transfer protocol - fixed header
          break;
        default:
          packet.rtpHeader = api.readRTPFixedHeader(bits);
      }
      return packet;
    },
    parsePackets: function(buf) {
      var bits, packet, packets, payloadValue;
      bits = new Bits(buf);
      packets = [];
      while (bits.has_more_data()) {
        packet = {};
        payloadValue = bits.get_byte_at(1); // including marker bit
        switch (payloadValue) {
          case api.RTCP_PACKET_TYPE_SENDER_REPORT:
            packet.rtcpSenderReport = api.readRTCPSenderReport(bits);
            break;
          case api.RTCP_PACKET_TYPE_RECEIVER_REPORT:
            packet.rtcpReceiverReport = api.readRTCPReceiverReport(bits);
            break;
          case api.RTCP_PACKET_TYPE_SOURCE_DESCRIPTION:
            packet.rtcpSourceDescription = api.readRTCPSourceDescription(bits);
            break;
          case api.RTCP_PACKET_TYPE_GOODBYE:
            packet.rtcpGoodbye = api.readRTCPGoodbye(bits);
            break;
          case api.RTCP_PACKET_TYPE_APPLICATION_DEFINED:
            packet.rtcpApplicationDefined = api.readRTCPApplicationDefined(
              bits
            ); // RTP data transfer protocol - fixed header
            break;
          default:
            packet.rtpHeader = api.readRTPFixedHeader(bits);
        }
        packets.push(packet);
      }
      return packets;
    },
    // Replace SSRC in-place in the given RTP header
    replaceSSRCInRTP: function(buf, ssrc) {
      buf[8] = (ssrc >>> 24) & 0xff;
      buf[9] = (ssrc >>> 16) & 0xff;
      buf[10] = (ssrc >>> 8) & 0xff;
      buf[11] = ssrc & 0xff;
    },
    // ntpTimestamp: [ <32-bit second part>, <32-bit fractional second part> ]
    ntpTimestampToTime: function(ntpTimestamp) {
      var ms, sec;
      sec = ntpTimestamp[0] - EPOCH;
      ms = ntpTimestamp[1] / NTP_SCALE_FRAC / 1000;
      return sec * 1000 + ms;
    },
    // Get NTP timestamp for a time
    // time is expressed the same as Date.now()
    getNTPTimestamp: function(time) {
      var ms, ntp_sec, ntp_usec, sec;
      sec = parseInt(time / 1000);
      ms = time - sec * 1000;
      ntp_sec = sec + EPOCH;
      ntp_usec = Math.round(ms * 1000 * NTP_SCALE_FRAC);
      return [ntp_sec, ntp_usec];
    },
    readAACPayload: function(bits, params) {
      var accessUnit, auHeader, auHeaders, i, info, j, k, len, ref;
      info = {};
      info.auHeadersLengthBits = bits.read_bits(16); // in bits
      info.numAUHeaders = info.auHeadersLengthBits / 16;
      auHeaders = [];
      for (
        i = j = 0, ref = info.numAUHeaders;
        0 <= ref ? j < ref : j > ref;
        i = 0 <= ref ? ++j : --j
      ) {
        params.index = i;
        auHeaders.push(api.readAACAUHeader(bits, params));
      }
      info.auHeaders = auHeaders;
      info.accessUnits = [];
      for (k = 0, len = auHeaders.length; k < len; k++) {
        auHeader = auHeaders[k];
        info.accessUnits.push(bits.read_bytes(auHeader.auSize));
        accessUnit = info.accessUnits[info.accessUnits.length - 1];
      }
      return info;
    },
    readAACAUHeader: function(bits, params) {
      var info;
      if (params.sizelength == null) {
        throw new Error("sizelength is not defined in params");
      }
      info = {};
      // size in octets of the associated Access Unit in the
      // Access Unit Data Section in the same RTP packet
      info.auSize = bits.read_bits(params.sizelength);
      // serial number of the associated Access Unit (fragment).
      if (params.index == null) {
        throw new Error("index is not defined in params");
      }
      if (params.index > 0) {
        if (params.indexdeltalength == null) {
          throw new Error("indexdeltalength is not defined in params");
        }
        info.auIndexDelta = bits.read_bits(params.indexdeltalength);
      } else {
        if (params.indexlength == null) {
          throw new Error("indexlength is not defined in params");
        }
        info.auIndex = bits.read_bits(params.indexlength);
      }
      return info;
    },
    // Used for encapsulating AAC audio data
    // opts:
    //   accessUnitLength (number): number of bytes in the access unit
    createAudioHeader: function(opts) {
      var accessUnit, header, j, len, numBits, ref;
      if (opts.accessUnits.length > 4095) {
        throw new Error(
          `too many audio access units: ${opts.accessUnits.length} (must be <= 4095)`
        );
      }
      numBits = opts.accessUnits.length * 16; // 2 bytes per access unit
      //# payload
      //# See section 3.2.1 and 3.3.6 of RFC 3640 for details
      //# AU Header Section
      // AU-headers-length(16) for AAC-hbr
      // Number of bits in the AU-headers
      header = [(numBits >> 8) & 0xff, numBits & 0xff];
      ref = opts.accessUnits;
      for (j = 0, len = ref.length; j < len; j++) {
        accessUnit = ref[j];
        header = header.concat(api.createAudioAUHeader(accessUnit.length));
      }
      return header;
    },
    groupAudioFrames: function(adtsFrames) {
      var adtsFrame, currentGroup, groups, i, j, len, packetSize;
      packetSize = RTP_HEADER_LEN;
      groups = [];
      currentGroup = [];
      for (i = j = 0, len = adtsFrames.length; j < len; i = ++j) {
        adtsFrame = adtsFrames[i];
        packetSize += adtsFrame.length + 2; // 2 bytes for AU-Header
        if (packetSize > MAX_PAYLOAD_SIZE) {
          groups.push(currentGroup);
          currentGroup = [];
          packetSize = RTP_HEADER_LEN + adtsFrame.length + 2;
        }
        currentGroup.push(adtsFrame);
      }
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      return groups;
    },
    createAudioAUHeader: function(accessUnitLength) {
      // AU Header
      // AU-size(13) by SDP
      // AU-Index(3) or AU-Index-Delta(3)
      // AU-Index is used for the first access unit, and the value must be 0.
      // AU-Index-Delta is used for the consecutive access units.
      // When interleaving is not applied, AU-Index-Delta is 0.
      return [accessUnitLength >> 5, (accessUnitLength & 0b11111) << 3];
    },
    // Used for encapsulating H.264 video data
    // There is no Auxiliary Section for AAC-hbr
    createFragmentationUnitHeader: function(opts) {
      return [
        // Fragmentation Unit
        // See section 5.8 of RFC 6184 for details

        // FU indicator
        // forbidden_zero_bit(1), nal_ref_idc(2), type(5)
        // type is 28 for FU-A
        opts.nal_ref_idc | 28,
        // FU header
        // start bit(1) == 0, end bit(1) == 1, reserved bit(1), type(5)
        (opts.isStart << 7) | (opts.isEnd << 6) | opts.nal_unit_type
      ];
    },
    // Create RTP header
    // opts:
    //   marker (boolean): true if this is the last packet of the
    //                     access unit indicated by the RTP timestamp
    //   payloadType (number): payload type
    //   sequenceNumber (number): sequence number
    //   timestamp (number): timestamp in 90 kHz clock rate
    //   ssrc (number): SSRC (can be null)
    createRTPHeader: function(opts) {
      var ref, seqNum, ssrc, ts;
      seqNum = opts.sequenceNumber;
      ts = opts.timestamp;
      ssrc = (ref = opts.ssrc) != null ? ref : 0;
      return [
        // version(2): 2
        // padding(1): 0
        // extension(1): 0
        // CSRC count(4): 0
        0b10000000,
        // marker(1)
        // payload type(7)
        (opts.marker << 7) | opts.payloadType,
        // sequence number(16)
        seqNum >>> 8,
        seqNum & 0xff,
        // timestamp(32) in 90 kHz clock rate
        (ts >>> 24) & 0xff,
        (ts >>> 16) & 0xff,
        (ts >>> 8) & 0xff,
        ts & 0xff,
        // SSRC(32)
        (ssrc >>> 24) & 0xff,
        (ssrc >>> 16) & 0xff,
        (ssrc >>> 8) & 0xff,
        ssrc & 0xff
      ];
    },
    // Create RTCP BYE (Goodbye) packet
    createGoodbye: function(opts) {
      var data, j, len, length, padLen, reason, reasonLen, ssrc, ssrcs;
      if ((opts != null ? opts.ssrcs : void 0) == null) {
        throw new Error("createGoodbye: ssrcs is required");
      }
      ssrcs = opts.ssrcs;
      if (ssrcs.length > 0b11111) {
        throw new Error(
          `createGoodbye: too many ssrcs: ${ssrcs.length} (must be <= 31)`
        );
      }
      // Reason for leaving
      reason = [...Buffer.from("End of stream", "utf8")]; // Convert Buffer to array
      reasonLen = reason.length;
      // Number of bytes until the next 32-bit boundary
      padLen = 4 - ((1 + reasonLen) % 4);
      if (reason.length > 0xff) {
        throw new Error(
          `createGoodbye: reason is too long: ${reason.length} (must be <= 255)`
        );
      }
      // Length of this RTCP packet in 32-bit words minus one
      // including the header and any padding
      length = (4 + ssrcs.length * 4 + 1 + reasonLen + padLen) / 4 - 1;
      data = [
        // See section 6.6 for details

        // version(2): 2 (RTP version 2)
        // padding(1): 0 (padding doesn't exist)
        // source count(5): number of SSRC/CSRC identifiers
        0b10000000 | ssrcs.length,
        // packet type(8): 203 (RTCP BYE)
        203,
        // length(16)
        length >> 8,
        length & 0xff
      ];
      for (j = 0, len = ssrcs.length; j < len; j++) {
        ssrc = ssrcs[j];
        // Append SSRC
        data.push(
          (ssrc >>> 24) & 0xff,
          (ssrc >>> 16) & 0xff,
          (ssrc >>> 8) & 0xff,
          ssrc & 0xff
        );
      }
      data.push(reason.length);
      data = data.concat(reason);
      while (padLen-- > 0) {
        data.push(0x00);
      }
      return data;
    },
    // Create RTCP Sender Report packet
    // opts:
    //   time: timestamp of the packet
    //   rtpTime: timestamp relative to the start point of media
    //   ssrc: SSRC
    //   packetCount: packet count
    //   octetCount: octetCount
    createSenderReport: function(opts) {
      var length, ntp_ts, octetCount, packetCount, rtp_ts, ssrc;
      if ((opts != null ? opts.ssrc : void 0) == null) {
        throw new Error("createSenderReport: ssrc is required");
      }
      ssrc = opts.ssrc;
      if ((opts != null ? opts.packetCount : void 0) == null) {
        throw new Error("createSenderReport: packetCount is required");
      }
      packetCount = opts.packetCount;
      if ((opts != null ? opts.octetCount : void 0) == null) {
        throw new Error("createSenderReport: octetCount is required");
      }
      octetCount = opts.octetCount;
      if ((opts != null ? opts.time : void 0) == null) {
        throw new Error("createSenderReport: time is required");
      }
      ntp_ts = api.getNTPTimestamp(opts.time);
      if ((opts != null ? opts.rtpTime : void 0) == null) {
        throw new Error("createSenderReport: rtpTime is required");
      }
      rtp_ts = opts.rtpTime;
      length = 6; // 28 (packet bytes) / 4 (32-bit word) - 1
      return [
        // See section 6.4.1 for details

        // version(2): 2 (RTP version 2)
        // padding(1): 0 (padding doesn't exist)
        // reception report count(5): 0 (no reception report blocks)
        0b10000000,
        // packet type(8): 200 (RTCP Sender Report)
        200,
        // length(16)
        length >> 8,
        length & 0xff,
        // SSRC of sender(32)
        (ssrc >>> 24) & 0xff,
        (ssrc >>> 16) & 0xff,
        (ssrc >>> 8) & 0xff,
        ssrc & 0xff,
        // [sender info]
        // NTP timestamp(64)
        (ntp_ts[0] >>> 24) & 0xff,
        (ntp_ts[0] >>> 16) & 0xff,
        (ntp_ts[0] >>> 8) & 0xff,
        ntp_ts[0] & 0xff,
        (ntp_ts[1] >>> 24) & 0xff,
        (ntp_ts[1] >>> 16) & 0xff,
        (ntp_ts[1] >>> 8) & 0xff,
        ntp_ts[1] & 0xff,
        // RTP timestamp(32)
        (rtp_ts >>> 24) & 0xff,
        (rtp_ts >>> 16) & 0xff,
        (rtp_ts >>> 8) & 0xff,
        rtp_ts & 0xff,
        // sender's packet count(32)
        (packetCount >>> 24) & 0xff,
        (packetCount >>> 16) & 0xff,
        (packetCount >>> 8) & 0xff,
        packetCount & 0xff,
        // sender's octet count(32)
        (octetCount >>> 24) & 0xff,
        (octetCount >>> 16) & 0xff,
        (octetCount >>> 8) & 0xff,
        octetCount & 0xff
      ];
    },
    // Parse config parameter for AAC
    // see: RFC 3640, 4.1. MIME Type Registration
    parseAACConfig: function(str) {
      var buf;
      if (str === '""') {
        // empty string
        return null;
      }
      buf = Buffer.from(str, "hex");
      return aac.parseAudioSpecificConfig(buf);
    }
  };

  module.exports = api;
}.call(this));

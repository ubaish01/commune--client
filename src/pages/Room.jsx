import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { WS_URL } from "../constants/constants";
import EVENT from "../constants/events";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

let device;
let rtpCapabilities;
let producerTransport;
let consumerTransports = [];
let audioProducer;
let videoProducer;
let consumer;
let isProducer = false;

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
let params = {
  // mediasoup params
  encodings: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

let audioParams;
let videoParams = { params };
let consumingTransports = [];

const useSocket = () => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const ws = io(WS_URL);
    setSocket(ws);
  }, []);

  return socket;
};

const Room = () => {
  const params = useParams();
  const roomName = params.roomID;
  const name = params.name;
  const socket = useSocket();

  socket?.on(EVENT.CONNECTION_SUCCESS, ({ socketId }) => {
    console.log(socketId);
    getLocalStream();
  });

  const streamSuccess = (stream) => {
    localVideo.srcObject = stream;

    audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
    videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

    joinRoom();
  };

  const joinRoom = () => {
    socket?.emit(EVENT.JOIN_ROOM, { roomName, name }, (data) => {
      console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
      // we assign to local variable and will be used when
      // loading the client Device (see createDevice above)
      rtpCapabilities = data.rtpCapabilities;

      // once we have rtpCapabilities from the Router, create Device
      createDevice();
    });
  };

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: {
          width: {
            min: 640,
            max: 1920,
          },
          height: {
            min: 400,
            max: 1080,
          },
        },
      })
      .then(streamSuccess)
      .catch((error) => {
        console.log(error.message);
      });
  };

  // A device is an endpoint connecting to a Router on the
  // server side to send/recive media
  const createDevice = async () => {
    try {
      device = new mediasoupClient.Device();

      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
      // Loads the device with RTP capabilities of the Router (server side)
      await device.load({
        // see getRtpCapabilities() below
        routerRtpCapabilities: rtpCapabilities,
      });

      console.log("Device RTP Capabilities", device.rtpCapabilities);

      // once the device loads, create transport
      createSendTransport();
    } catch (error) {
      console.log(error);
      if (error.name === "UnsupportedError")
        console.warn("browser not supported");
    }
  };

  const createSendTransport = () => {
    // this is a call from Producer, so sender = true
    socket?.emit(
      EVENT.CREATE_WEB_RTC_TRANSPORT,
      { consumer: false },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }

        console.log(params);

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport = device.createSendTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              await socket?.emit(EVENT.TRANSPORT_CONNECT, {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              errback(error);
            }
          }
        );

        producerTransport.on(
          "produce",
          async (parameters, callback, errback) => {
            console.log(parameters);

            try {
              // tell the server to create a Producer
              // with the following parameters and produce
              // and expect back a server side producer id
              await socket?.emit(
                EVENT.TRANSPORT_PRODUCE,
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },
                ({ id, producersExist }) => {
                  // Tell the transport that parameters were transmitted and provide it with the
                  // server side producer's id.
                  callback({ id });

                  // if producers exist, then join room
                  if (producersExist) getProducers();
                }
              );
            } catch (error) {
              errback(error);
            }
          }
        );

        connectSendTransport();
      }
    );
  };

  const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above

    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);

    audioProducer.on("trackended", () => {
      console.log("audio track ended");

      // close audio track
    });

    audioProducer.on("transportclose", () => {
      console.log("audio transport ended");

      // close audio track
    });

    videoProducer.on("trackended", () => {
      console.log("video track ended");

      // close video track
    });

    videoProducer.on("transportclose", () => {
      console.log("video transport ended");

      // close video track
    });
  };

  const signalNewConsumerTransport = async (remoteProducer) => {
    const remoteProducerId = remoteProducer.producerID;
    //check if we are already consuming the remoteProducerId
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);
    console.log("Sending CREATE_WEB_RTC_TRANSPORT");
    await socket?.emit(
      EVENT.CREATE_WEB_RTC_TRANSPORT,
      { consumer: true },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }
        console.log(`PARAMS... ${params}`);

        let consumerTransport;
        try {
          consumerTransport = device.createRecvTransport(params);
        } catch (error) {
          // exceptions:
          // {InvalidStateError} if not loaded
          // {TypeError} if wrong arguments.
          console.log(error);
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              await socket?.emit(EVENT.TRANSPORT_RECV_CONNECT, {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              // Tell the transport that something was wrong
              errback(error);
            }
          }
        );

        connectRecvTransport(
          consumerTransport,
          remoteProducerId,
          params.id,
          remoteProducer.name
        );
      }
    );
  };

  // server informs the client of a new producer just joined
  socket?.on(EVENT.NEW_PRODUCER, (newProducer) => {
    console.log(newProducer);
    signalNewConsumerTransport(newProducer);
  });

  const getProducers = () => {
    socket?.emit(EVENT.GET_PRODUCERS, (producersList) => {
      // for each of the producer create a consumer
      // producerIds.forEach(id => signalNewConsumerTransport(id))
      producersList.forEach(signalNewConsumerTransport);
    });
  };

  const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId,
    producerName
  ) => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await socket?.emit(
      EVENT.CONSUME,
      {
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }) => {
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }

        console.log(`Consumer Params `);
        // console.log(params);
        // then consume with the local consumer transport
        // which creates a consumer
        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        consumerTransports = [
          ...consumerTransports,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ];

        const { track } = consumer;
        // create a new div element for the new consumer media
        // and append to the video container
        const newElem = document.createElement("div");
        newElem.setAttribute("id", `td-${remoteProducerId}`);

        // <div className="md:col-span-2 col-span-3 relative border-2 border-purple-500 rounded-md overflow-hidden">
        //       <div className="absolute top-1 left-2">you*</div>
        //       <video id="localVideo" autoPlay className="video" muted></video>
        //     </div>

        if (track.kind == "audio") {
          newElem.setAttribute(
            "class",
            "remoteVideo border border-red-500 hidden  rounded-md overflow-hidden md:col-span-2 col-span-3"
          );
          //append to the audio container
          newElem.innerHTML =
            '<audio id="' + remoteProducerId + '" autoplay></audio>';
        } else {
          //append to the video container
          newElem.setAttribute(
            "class",
            "md:col-span-2 col-span-3 relative border-2 relative border-white flex items-start justify-start rounded-md overflow-hidden"
          );
          newElem.innerHTML = `
            <video id=${remoteProducerId} autoplay class="video" ></video>
             <div class='absolute z-10 text-white left-2 top-1' >${producerName}</div>   
            `;
        }

        videoContainer.appendChild(newElem);

        // destructure and retrieve the video track from the producer
        const videoElement = document.getElementById(remoteProducerId);
        console.log("TRACK KIND  : ", track.kind);
        console.log("PARAM KIND  : ", params.kind);
        videoElement.srcObject = new MediaStream([track]);

        // the server consumer started with media paused
        // so we need to inform the server to resume
        socket?.emit(EVENT.CONSUMER_RESUME, {
          serverConsumerId: params.serverConsumerId,
        });
      }
    );
  };

  socket?.on(EVENT.PRODUCER_CLOSED, ({ remoteProducerId }) => {
    // server notification is received when a producer is closed
    // we need to close the client-side consumer and associated transport
    const producerToClose = consumerTransports.find(
      (transportData) => transportData.producerId === remoteProducerId
    );
    producerToClose.consumerTransport.close();
    producerToClose.consumer.close();

    // remove the consumer transport from the list
    consumerTransports = consumerTransports.filter(
      (transportData) => transportData.producerId !== remoteProducerId
    );

    // remove the video div element
    videoContainer.removeChild(
      document.getElementById(`td-${remoteProducerId}`)
    );
  });

  return (
    <div className="flex items-center justify-center p-8">
      <div id="video">
        <div className="remoteColumn ">
          <div className="grid grid-cols-6 gap-4" id="videoContainer">
            <div className="md:col-span-2 col-span-3 relative border-2 border-purple-500 rounded-md overflow-hidden">
              <div className="absolute top-1 left-2">you*</div>
              <video id="localVideo" autoPlay className="video" muted></video>
            </div>
          </div>
        </div>
        <table>
          <tbody>
            <tr>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Room;

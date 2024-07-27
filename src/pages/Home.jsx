import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const Home = () => {
  const [roomID, setRoomID] = useState("commune");
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const joinRoom = () => {
    if (!roomID) {
      alert("Please enter a room id");
      return;
    }
    if (!name) {
      alert("Please enter your name");
      return;
    }

    navigate(`/room/${roomID}/${name}`);
  };

  return (
    <div className=" h-screen flex items-center justify-center flex-col">
      <h1 className="text-8xl font-bold mb-6">Commune</h1>
      <div className="grid gap-2">
        <div>
          <input
            className="w-[35rem] text-black h-12 px-4 text-xl rounded-sm "
            type="text"
            placeholder="enter the room id to join"
            value={roomID}
            onChange={(e) => {
              if (e.target.value != " ") setRoomID(e.target.value);
            }}
          />
        </div>
        <div>
          <input
            className="w-[35rem] text-black h-12 px-4 text-xl rounded-sm "
            type="text"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => {
              if (e.target.value != " ") setName(e.target.value);
            }}
          />
        </div>
        <div className="w-full flex items-center justify-center">
          <button
            onClick={joinRoom}
            className="bg-gray-900 px-20 py-3 mt-2 text-xl capitalize rounded-md"
          >
            join
          </button>
        </div>
      </div>
    </div>
  );
};

export default Home;
